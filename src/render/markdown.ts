// Markdown → HTML for export, printing, table cells and HTML previews. Mirrors
// the dialect the live editor parses (GFM + Typora extensions) and produces
// Typora-shaped markup (#write, .md-fences, .md-toc, ...) so Typora themes
// apply to exported documents unchanged.
import markdownit, { type MarkdownIt, type StateBlock, type StateInline, type StateCore, type Token } from "markdown-it";
import footnote from "markdown-it-footnote";
import mark from "markdown-it-mark";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import taskLists from "markdown-it-task-lists";
import { full as emoji } from "markdown-it-emoji";
import DOMPurify from "dompurify";
import { highlightCode, escapeHtml } from "./highlight";
import { diagramLanguages } from "./diagrams";

export interface RenderOptions {
  /** Map an image/link URL from the document to a displayable URL. */
  resolveUrl?: (url: string) => string;
  /** Include the YAML front matter as a block (Typora hides it in exports). */
  frontMatter?: boolean;
}

export function slugify(text: string) {
  return text.trim().toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function mathInline(state: StateInline, silent: boolean) {
  const src = state.src, start = state.pos;
  if (src.charCodeAt(start) !== 36 || src.charCodeAt(start + 1) === 36) return false;
  if (start > 0 && src.charCodeAt(start - 1) === 36) return false;
  const first = src.charCodeAt(start + 1);
  if (first === 32 || first === 9 || Number.isNaN(first)) return false;
  for (let i = start + 1; i < state.posMax; i++) {
    const ch = src.charCodeAt(i);
    if (ch === 92) { i++; continue; }
    if (ch !== 36) continue;
    const prev = src.charCodeAt(i - 1);
    if (prev === 32 || prev === 9) continue;
    const after = src.charCodeAt(i + 1);
    if (after >= 48 && after <= 57) continue;
    if (!silent) {
      const token = state.push("math_inline", "span", 0);
      token.content = src.slice(start + 1, i);
      token.markup = "$";
    }
    state.pos = i + 1;
    return true;
  }
  return false;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (state.src.slice(pos, pos + 2) !== "$$") return false;
  pos += 2;
  let firstLine = state.src.slice(pos, max);
  let lastLine = "";
  let next = startLine;
  let found = false;
  if (/\$\$\s*$/.test(firstLine) && firstLine.trim() !== "$$" && firstLine.trim().length > 2) {
    firstLine = firstLine.replace(/\$\$\s*$/, "");
    found = true;
  }
  if (silent) return true;
  if (!found) {
    for (next = startLine + 1; next < endLine; next++) {
      pos = state.bMarks[next] + state.tShift[next];
      max = state.eMarks[next];
      if (pos < max && state.sCount[next] < state.blkIndent) break;
      const text = state.src.slice(pos, max);
      if (/\$\$\s*$/.test(text)) {
        lastLine = text.replace(/\$\$\s*$/, "");
        found = true;
        break;
      }
    }
  }
  state.line = next + 1;
  const token = state.push("math_block", "div", 0);
  token.block = true;
  token.content = (firstLine.trim() ? firstLine + "\n" : "") +
    state.getLines(startLine + 1, next, state.tShift[startLine], true) +
    (lastLine.trim() ? lastLine : "");
  token.map = [startLine, state.line];
  token.markup = "$$";
  return true;
}

function frontMatter(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  if (startLine !== 0 || state.src.slice(0, 3) !== "---") return false;
  if (state.src.slice(state.bMarks[0], state.eMarks[0]).trim() !== "---") return false;
  let next = 1;
  for (; next < endLine; next++) {
    const text = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]).trim();
    if (text === "---" || text === "...") break;
  }
  if (next >= endLine) return false;
  if (silent) return true;
  const token = state.push("front_matter", "pre", 0);
  token.block = true;
  token.content = state.getLines(1, next, 0, true);
  token.map = [0, next + 1];
  state.line = next + 1;
  return true;
}

function alerts(md: MarkdownIt) {
  md.core.ruler.after("block", "typora_alerts", (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "blockquote_open") continue;
      const inline = tokens[i + 2];
      if (tokens[i + 1]?.type !== "paragraph_open" || inline?.type !== "inline") continue;
      const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i.exec(inline.content);
      if (!match) continue;
      const kind = match[1].toUpperCase();
      tokens[i].attrJoin("class", `md-alert md-alert-${kind.toLowerCase()}`);
      inline.content = inline.content.slice(match[0].length);
      const title = new state.Token("html_block", "", 0);
      title.content = `<p class="md-alert-text-container"><span class="md-alert-text md-alert-text-${kind.toLowerCase()}">${kind[0] + kind.slice(1).toLowerCase()}</span></p>`;
      tokens.splice(i + 1, 0, title);
      if (!inline.content.trim()) { tokens.splice(i + 2, 3); }
    }
  });
}

function tableOfContents(md: MarkdownIt) {
  md.core.ruler.push("typora_toc", (state: StateCore) => {
    const headings: { level: number; text: string; id: string }[] = [];
    const used = new Map<string, number>();
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type !== "heading_open") continue;
      const inline = state.tokens[i + 1];
      const text = inline.children?.filter((child: Token) => child.type === "text" || child.type === "code_inline").map((child: Token) => child.content).join("") ?? inline.content;
      let id = slugify(text) || "heading";
      const count = used.get(id) || 0;
      used.set(id, count + 1);
      if (count) id += "-" + count;
      token.attrSet("id", id);
      headings.push({ level: Number(token.tag.slice(1)), text, id });
    }
    for (let i = 0; i < state.tokens.length; i++) {
      const inline = state.tokens[i + 1];
      if (state.tokens[i].type !== "paragraph_open" || inline?.type !== "inline" || !/^\[toc\]$/i.test(inline.content.trim())) continue;
      const html = new state.Token("html_block", "", 0);
      html.content = tocHtml(headings);
      state.tokens.splice(i, 3, html);
    }
  });
}

export function tocHtml(headings: { level: number; text: string; id: string }[]) {
  if (!headings.length) return `<div class="md-toc"></div>`;
  const min = Math.min(...headings.map(h => h.level));
  return `<div class="md-toc"><p class="md-toc-content">${headings.map(h =>
    `<span class="md-toc-item md-toc-h${h.level - min + 1}"><a class="md-toc-inner" href="#${encodeURIComponent(h.id)}">${escapeHtml(h.text)}</a></span>`).join("")}</p></div>`;
}

function createRenderer(options: RenderOptions) {
  const md = markdownit({ html: true, linkify: true, breaks: false, typographer: false });
  md.use(footnote).use(mark).use(sub).use(sup).use(emoji as (md: MarkdownIt) => void).use(taskLists, { enabled: true, label: false });
  md.inline.ruler.after("escape", "math_inline", mathInline);
  md.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.block.ruler.before("hr", "front_matter", frontMatter);
  md.use(alerts).use(tableOfContents);

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="md-math-inline" data-math="${escapeHtml(tokens[idx].content)}" data-display="false">${escapeHtml(tokens[idx].content)}</span>`;
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="md-math-block" data-math="${escapeHtml(tokens[idx].content)}" data-display="true">${escapeHtml(tokens[idx].content)}</div>\n`;
  md.renderer.rules.front_matter = (tokens, idx) =>
    options.frontMatter ? `<pre class="md-meta-block">${escapeHtml(tokens[idx].content)}</pre>\n` : "";
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info.trim();
    const language = info.split(/\s+/)[0].toLowerCase();
    if (diagramLanguages.has(language)) {
      return `<div class="md-diagram" data-diagram="${escapeHtml(language)}" data-source="${escapeHtml(token.content)}"></div>\n`;
    }
    return `<pre class="md-fences cm-s-inner" lang="${escapeHtml(language)}"><code class="language-${escapeHtml(language)}">${highlightCode(token.content.replace(/\n$/, ""), info)}</code></pre>\n`;
  };
  const resolve = options.resolveUrl;
  if (resolve) {
    const image = md.renderer.rules.image!;
    md.renderer.rules.image = (tokens, idx, opts, env, self) => {
      const src = tokens[idx].attrGet("src") as string | null;
      if (src) tokens[idx].attrSet("src", resolve(src));
      return image(tokens, idx, opts, env, self);
    };
  }
  return md;
}

const defaultRenderer = createRenderer({});

const purifyConfig = {
  ADD_TAGS: ["iframe", "video", "audio", "source", "details", "summary", "kbd", "mark", "u", "font", "center"],
  ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling", "target", "controls", "data-math", "data-display", "data-diagram", "data-source", "lang", "align", "color", "size", "face"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data|blob|file):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName === "iframe") {
    const element = node as Element;
    const src = element.getAttribute("src") || "";
    if (!/^https:\/\//i.test(src)) element.remove();
    else element.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-presentation");
  }
});

export function sanitizeHtml(html: string) {
  return DOMPurify.sanitize(html, purifyConfig) as string;
}

export function renderMarkdown(source: string, options: RenderOptions = {}) {
  const md = options.resolveUrl || options.frontMatter ? createRenderer(options) : defaultRenderer;
  return sanitizeHtml(md.render(source));
}

export function renderInline(source: string, options: RenderOptions = {}) {
  const md = options.resolveUrl ? createRenderer(options) : defaultRenderer;
  return sanitizeHtml(md.renderInline(source));
}

export type { Token };
