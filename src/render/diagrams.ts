// Diagram code blocks (```mermaid, plus Typora's ```flow and ```sequence via
// Mermaid translation) rendered to sanitized SVG, cached by source.
import DOMPurify from "dompurify";

let mermaidLoader: Promise<typeof import("mermaid")["default"]> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, string>();
let appearance: "light" | "dark" = "light";
/** Bumped when cached renders become stale (appearance change), so widgets redraw. */
export let diagramGeneration = 0;
let counter = 0;

export const diagramLanguages = new Set(["mermaid", "flow", "sequence"]);

export function setDiagramAppearance(next: "light" | "dark") {
  if (next !== appearance) { appearance = next; cache.clear(); diagramGeneration++; }
}

/** Typora's flowchart.js syntax → Mermaid flowchart. */
export function flowToMermaid(source: string) {
  const nodes = new Map<string, { type: string; label: string }>();
  const edges: string[] = [];
  const shape = (id: string) => {
    const node = nodes.get(id);
    const label = (node?.label || id).replace(/"/g, "#quot;");
    switch (node?.type) {
      case "start": case "end": return `${id}(["${label}"])`;
      case "condition": return `${id}{"${label}"}`;
      case "inputoutput": return `${id}[/"${label}"/]`;
      case "subroutine": return `${id}[["${label}"]]`;
      case "parallel": return `${id}[["${label}"]]`;
      default: return `${id}["${label}"]`;
    }
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const def = /^([\w-]+)=>(\w+):\s*(.*?)(?:\|[\w]+)?(?::>.*)?$/.exec(line);
    if (def) { nodes.set(def[1], { type: def[2], label: def[3] }); continue; }
    const parts = line.split("->").map(part => part.trim());
    for (let i = 0; i + 1 < parts.length; i++) {
      const from = /^([\w-]+)(?:\((\w+)(?:,\s*\w+)?\))?$/.exec(parts[i]);
      const to = /^([\w-]+)/.exec(parts[i + 1]);
      if (!from || !to) continue;
      const label = from[2] && from[2] !== "right" && from[2] !== "left" && from[2] !== "bottom" && from[2] !== "top" ? `|${from[2]}|` : "";
      edges.push(`${shape(from[1])} -->${label} ${shape(to[1])}`);
    }
  }
  return "flowchart TD\n" + edges.map(edge => "  " + edge).join("\n");
}

/** js-sequence-diagrams syntax → Mermaid sequenceDiagram (close enough for most docs). */
export function sequenceToMermaid(source: string) {
  const lines = ["sequenceDiagram"];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let match;
    if ((match = /^title\s*:?\s*(.*)$/i.exec(line))) { lines.push(`  title ${match[1]}`); continue; }
    if ((match = /^participant\s+(.*)$/i.exec(line))) { lines.push(`  participant ${match[1]}`); continue; }
    if ((match = /^note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i.exec(line))) { lines.push(`  Note ${match[1].toLowerCase()} ${match[2].trim()}: ${match[3]}`); continue; }
    if ((match = /^(.+?)\s*(-->>|->>|-->|->|--x|-x)\s*(.+?)\s*:\s*(.*)$/.exec(line))) {
      const arrow = { "->": "->>", "-->": "-->>", "->>": "-)", "-->>": "--)", "-x": "-x", "--x": "--x" }[match[2]] || "->>";
      lines.push(`  ${match[1].trim()}${arrow}${match[3].trim()}: ${match[4]}`);
    }
  }
  return lines.join("\n");
}

function toMermaid(language: string, source: string) {
  if (language === "flow") return flowToMermaid(source);
  if (language === "sequence") return sequenceToMermaid(source);
  return source;
}

export function cachedDiagram(language: string, source: string) {
  return cache.get(language + "\n" + source);
}

export function renderDiagram(language: string, source: string): Promise<string> {
  const key = language + "\n" + source;
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const task = queue.catch(() => {}).then(async () => {
    mermaidLoader ??= import("mermaid").then(module => module.default);
    const mermaid = await mermaidLoader;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: appearance === "dark" ? "dark" : "default",
      flowchart: { htmlLabels: false },
    });
    const { svg } = await mermaid.render(`typorium-diagram-${++counter}`, toMermaid(language, source));
    const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["foreignObject"] });
    if (cache.size > 300) cache.clear();
    cache.set(key, clean);
    return clean;
  });
  queue = task;
  return task;
}

export function fillDiagram(element: HTMLElement, language: string, source: string) {
  const hit = cachedDiagram(language, source);
  if (hit !== undefined) { element.innerHTML = hit; return; }
  element.classList.add("md-diagram-pending");
  renderDiagram(language, source).then(svg => {
    element.classList.remove("md-diagram-pending", "md-diagram-error");
    element.innerHTML = svg;
  }, error => {
    element.classList.remove("md-diagram-pending");
    element.classList.add("md-diagram-error");
    element.textContent = "Diagram error: " + (error instanceof Error ? error.message.split("\n")[0] : String(error));
    document.querySelectorAll('[id^="dtyporium-diagram-"]').forEach(node => node.remove());
  });
}

export async function renderDiagramsIn(container: ParentNode) {
  for (const target of container.querySelectorAll<HTMLElement>("[data-diagram]")) {
    try { target.innerHTML = await renderDiagram(target.dataset.diagram!, target.dataset.source || ""); }
    catch { target.classList.add("md-diagram-error"); }
  }
}
