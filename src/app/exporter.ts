// Export: HTML (with or without theme styles), PDF/print, plain Markdown,
// "Copy as HTML". Exported markup follows Typora's structure (#write, .md-fences,
// .md-toc, ...) so Typora themes and tooling understand it.
import { renderMarkdown } from "../render/markdown";
import { renderMathIn } from "../render/math";
import { renderDiagramsIn } from "../render/diagrams";
import { preloadLanguages, escapeHtml } from "../render/highlight";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import DOMPurify from "dompurify";

export interface ExportContext {
  title: string;
  /** Resolve an image src to a displayable URL (blob:, data:, https:). */
  resolveImage(src: string): Promise<string | null>;
  css: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Render Markdown to a fully rendered #write element (math, diagrams, images resolved). */
export async function renderDocument(markdown: string, context: ExportContext, options: { embedImages: boolean }) {
  await preloadLanguages(markdown);
  const container = document.createElement("div");
  container.id = "write";
  container.innerHTML = renderMarkdown(markdown);
  await renderMathIn(container);
  await renderDiagramsIn(container);
  for (const img of container.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (!src || /^(data:|https?:)/i.test(src) && !options.embedImages) continue;
    try {
      const resolved = /^(data:)/i.test(src) ? src : await context.resolveImage(src);
      if (!resolved) continue;
      if (options.embedImages && !resolved.startsWith("data:")) {
        const response = await fetch(resolved);
        if (response.ok) img.src = await blobToDataUrl(await response.blob());
      } else img.src = resolved;
    } catch { /* keep original src */ }
  }
  for (const node of container.querySelectorAll("[data-math],[data-diagram]")) {
    node.removeAttribute("data-source");
  }
  return container;
}

export async function exportHtml(markdown: string, context: ExportContext, withStyles: boolean) {
  const write = await renderDocument(markdown, context, { embedImages: true });
  const style = withStyles ? `<style>\n${context.css}\nbody{background:var(--bg-color,#fff);color:var(--text-color,#333);margin:0}\n</style>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Typorium">
<title>${escapeHtml(context.title)}</title>
${style}
</head>
<body class="typora-export">
<div class="typora-export-content">
${write.outerHTML}
</div>
</body>
</html>
`;
}

/** Print (and "Save as PDF" from the print dialog) using an in-page print root. */
export async function printDocument(markdown: string, context: ExportContext, page: { size: string; margin: number }) {
  const write = await renderDocument(markdown, context, { embedImages: false });
  document.getElementById("print-root")?.remove();
  document.getElementById("print-style")?.remove();
  const root = document.createElement("div");
  root.id = "print-root";
  root.className = "typora-export";
  root.append(write);
  const style = document.createElement("style");
  style.id = "print-style";
  style.textContent = `@page { size: ${page.size}; margin: ${page.margin}mm; }
@media screen { #print-root { display: none; } }
@media print {
  body > *:not(#print-root) { display: none !important; }
  #print-root { display: block; }
  #print-root #write { padding: 0; max-width: none; }
}`;
  document.body.append(root);
  document.head.append(style);
  await Promise.all([...write.querySelectorAll("img")].map(img => img.complete ? null : new Promise(resolve => { img.onload = img.onerror = resolve; })));
  const previousTitle = document.title;
  document.title = context.title;
  const cleanup = () => { root.remove(); style.remove(); document.title = previousTitle; };
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
}

/* ---------- HTML → Markdown (paste and import) ---------- */

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*", hr: "---" });
turndown.use(gfm as TurndownService.Plugin);
turndown.addRule("underline", { filter: ["u", "ins"], replacement: content => `<u>${content}</u>` });
turndown.addRule("highlight", { filter: "mark", replacement: content => `==${content}==` });
turndown.addRule("subscript", { filter: "sub", replacement: content => `~${content}~` });
turndown.addRule("superscript", { filter: "sup", replacement: content => `^${content}^` });
turndown.addRule("math", {
  filter: node => node instanceof HTMLElement && node.hasAttribute("data-math"),
  replacement: (_content, node) => {
    const element = node as HTMLElement;
    const tex = element.getAttribute("data-math") || "";
    return element.getAttribute("data-display") === "true" ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
  },
});
turndown.addRule("fencedLanguage", {
  filter: node => node.nodeName === "PRE" && !!node.querySelector("code"),
  replacement: (_content, node) => {
    const element = node as HTMLElement;
    const code = element.querySelector("code")!;
    const language = (element.getAttribute("lang") || /language-(\S+)/.exec(code.className)?.[1] || "").trim();
    const text = code.textContent ?? "";
    const fence = text.includes("```") ? "~~~" : "```";
    return `\n\n${fence}${language}\n${text.replace(/\n$/, "")}\n${fence}\n\n`;
  },
});
turndown.remove(["script", "style", "meta", "title"]);

export function htmlToMarkdown(html: string) {
  const clean = DOMPurify.sanitize(html, { FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea"], KEEP_CONTENT: true, ADD_ATTR: ["data-math", "data-display", "lang"] });
  return turndown.turndown(clean).replace(/\n{3,}/g, "\n\n").trim();
}

export function markdownToClipboardHtml(markdown: string) {
  return renderMarkdown(markdown);
}
