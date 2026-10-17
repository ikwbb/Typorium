// Inline and line-level live preview: headings, emphasis, links, images,
// lists, task items, quotes, inline math, footnotes, emoji and inline HTML.
// Markup is hidden unless the selection touches the element (Typora's
// "reveal on focus" behaviour). Block prefixes (#, >, list markers) stay hidden
// and are atomic so the caret never lands inside them.
import { EditorState, RangeSet, RangeSetBuilder, type Range, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import emojiNames from "markdown-it-emoji/lib/data/full.mjs";
import { isActive, isLineActive, refreshDecorations, setFocused } from "./state";
import {
  BulletWidget, OrderedWidget, CheckboxWidget, ImageWidget, MathWidget, FootnoteRefWidget, EmojiWidget, AlertLabelWidget,
} from "./widgets";

const hidden = Decoration.replace({});
const meta = Decoration.mark({ class: "md-meta" });

const inlineStyles: Record<string, { cls: string; marks: string }> = {
  Emphasis: { cls: "md-em", marks: "EmphasisMark" },
  StrongEmphasis: { cls: "md-strong", marks: "EmphasisMark" },
  Strikethrough: { cls: "md-del", marks: "StrikethroughMark" },
  Highlight: { cls: "md-mark", marks: "HighlightMark" },
  InlineCode: { cls: "md-code", marks: "CodeMark" },
  Subscript: { cls: "md-sub", marks: "SubscriptMark" },
  Superscript: { cls: "md-sup", marks: "SuperscriptMark" },
};

const htmlTagClasses: Record<string, string> = {
  u: "md-u", ins: "md-u", s: "md-del", del: "md-del", strike: "md-del", mark: "md-mark", kbd: "md-kbd",
  sub: "md-sub", sup: "md-sup", b: "md-strong", strong: "md-strong", i: "md-em", em: "md-em",
  small: "md-small", big: "md-big", span: "md-span", font: "md-span", a: "md-link", code: "md-code", q: "md-q", cite: "md-em",
};

const blockSkip = new Set(["FencedCode", "CodeBlock", "BlockMath", "Table", "HTMLBlock", "CommentBlock", "FrontMatter"]);

function parseAttributes(tag: string) {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g))
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return attrs;
}

function safeStyle(style: string) {
  return style.replace(/url\s*\(|expression\s*\(|position\s*:/gi, "").slice(0, 300);
}

function listDepth(node: SyntaxNode) {
  let depth = -1;
  for (let parent: SyntaxNode | null = node; parent; parent = parent.parent)
    if (parent.name === "BulletList" || parent.name === "OrderedList") depth++;
  return Math.max(0, depth);
}

interface Footnotes { index: Map<string, number>; text: Map<string, string> }

function scanFootnotes(state: EditorState): Footnotes {
  const source = state.doc.toString();
  const index = new Map<string, number>(), text = new Map<string, string>();
  if (!source.includes("[^")) return { index, text };
  for (const match of source.matchAll(/^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm)) text.set(match[1], match[2]);
  for (const match of source.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) if (!index.has(match[1])) index.set(match[1], index.size + 1);
  return { index, text };
}

/** End of the hidden prefix (quote marks, list marker, heading marks) on a line. */
function prefixEnd(state: EditorState, lineFrom: number) {
  const line = state.doc.lineAt(lineFrom);
  const match = /^((?:[ \t]*>[ \t]?)*)([ \t]*)(#{1,6}[ \t]+|(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/.exec(line.text);
  if (!match || !match[0].length) return line.from;
  const end = line.from + match[0].length;
  if (!match[3] && !match[1]) return line.from;
  // Only hide markup that the parser actually treats as structure.
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(end, -1); node; node = node.parent) {
    if (blockSkip.has(node.name) || node.name === "Paragraph" && !match[3] && !match[1]) return line.from;
    if (/^(ATXHeading\d|ListItem|Blockquote)$/.test(node.name)) return match[3] || match[1] ? end : line.from;
  }
  return line.from;
}

/** Keep the caret out of hidden block prefixes (Typora never shows them). */
export const prefixSelectionFilter = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.selection || tr.docChanged || tr.selection.ranges.length > 1 || !tr.selection.main.empty) return tr;
  const head = tr.selection.main.head;
  const state = tr.state;
  const line = state.doc.lineAt(head);
  const end = prefixEnd(state, line.from);
  if (end <= line.from || head >= end) return tr;
  const previous = tr.startState.selection.main.head;
  const target = previous === end && line.from > 0 && previous > head ? line.from - 1 : end;
  return [tr, { selection: { anchor: target }, sequential: true }];
});

class Builder {
  ranges: Range<Decoration>[] = [];
  atomic: { from: number; to: number }[] = [];
  footnotes: Footnotes | null = null;
  constructor(readonly state: EditorState) {}
  add(from: number, to: number, deco: Decoration) { if (from <= to) this.ranges.push(deco.range(from, to)); }
  hide(from: number, to: number, atomic = false) {
    if (from >= to) return;
    this.ranges.push(hidden.range(from, to));
    if (atomic) this.atomic.push({ from, to });
  }
  line(pos: number, cls: string, attributes?: Record<string, string>) {
    this.ranges.push(Decoration.line({ class: cls, attributes }).range(this.state.doc.lineAt(pos).from));
  }
  get notes() { return this.footnotes ??= scanFootnotes(this.state); }
}

function slice(state: EditorState, node: { from: number; to: number }) {
  return state.doc.sliceString(node.from, node.to);
}

function handleInlineStyle(b: Builder, node: SyntaxNodeRef) {
  const spec = inlineStyles[node.name];
  const active = isActive(b.state, node.from, node.to);
  b.add(node.from, node.to, Decoration.mark({ class: spec.cls }));
  for (const mark of node.node.getChildren(spec.marks)) {
    if (active) b.add(mark.from, mark.to, meta);
    else b.hide(mark.from, mark.to);
  }
}

function handleLink(b: Builder, node: SyntaxNodeRef) {
  const n = node.node;
  const marks = n.getChildren("LinkMark");
  const url = n.getChild("URL");
  const label = n.getChild("LinkLabel");
  if (marks.length < 2 || (!url && !label)) return;
  const textFrom = marks[0].to, textTo = marks[1].from;
  const href = url ? slice(b.state, url) : "";
  const active = isActive(b.state, node.from, node.to);
  b.add(textFrom, textTo, Decoration.mark({ class: "md-link", attributes: href ? { "data-href": href } : {} }));
  if (active) {
    b.add(node.from, textFrom, meta);
    b.add(textTo, node.to, Decoration.mark({ class: "md-meta md-link-url" }));
  } else {
    b.hide(node.from, textFrom);
    b.hide(textTo, node.to);
  }
}

function imageIsAlone(b: Builder, node: SyntaxNodeRef) {
  const parent = node.node.parent;
  if (!parent || parent.name !== "Paragraph") return false;
  return slice(b.state, parent).trim() === slice(b.state, node).trim();
}

function handleImage(b: Builder, node: SyntaxNodeRef) {
  const n = node.node;
  const marks = n.getChildren("LinkMark");
  const url = n.getChild("URL");
  const title = n.getChild("LinkTitle");
  const alt = marks.length >= 2 ? b.state.doc.sliceString(marks[0].to, marks[1].from) : "";
  let src = url ? slice(b.state, url) : "";
  if (src.startsWith("<") && src.endsWith(">")) src = src.slice(1, -1);
  const widget = new ImageWidget(src, alt, title ? slice(b.state, title).slice(1, -1) : "", {}, imageIsAlone(b, node));
  if (isActive(b.state, node.from, node.to)) {
    b.add(node.from, node.to, Decoration.mark({ class: "md-meta md-image-source" }));
    b.add(node.to, node.to, Decoration.widget({ widget, side: 1 }));
  } else b.add(node.from, node.to, Decoration.replace({ widget }));
}

function handleHtmlTags(b: Builder, container: SyntaxNodeRef) {
  const tags: { from: number; to: number; text: string }[] = [];
  container.node.cursor().iterate(child => {
    if (child.name === "HTMLTag") tags.push({ from: child.from, to: child.to, text: slice(b.state, child) });
    if (child.name === "Comment") b.add(child.from, child.to, Decoration.mark({ class: "md-comment" }));
    return !blockSkip.has(child.name);
  });
  if (!tags.length) return;
  const stack: { name: string; from: number; to: number; attrs: Record<string, string> }[] = [];
  for (const tag of tags) {
    const close = /^<\/([a-zA-Z][\w-]*)\s*>$/.exec(tag.text);
    const open = /^<([a-zA-Z][\w-]*)([^>]*?)(\/?)>$/s.exec(tag.text);
    if (open) {
      const name = open[1].toLowerCase();
      if (name === "img") {
        const attrs = parseAttributes(open[2]);
        const widget = new ImageWidget(attrs.src || "", attrs.alt || "", attrs.title || "",
          Object.fromEntries(Object.entries(attrs).filter(([key]) => ["width", "height", "style", "align"].includes(key))));
        if (isActive(b.state, tag.from, tag.to)) {
          b.add(tag.from, tag.to, Decoration.mark({ class: "md-meta md-image-source" }));
          b.add(tag.to, tag.to, Decoration.widget({ widget, side: 1 }));
        } else b.add(tag.from, tag.to, Decoration.replace({ widget }));
        continue;
      }
      if (open[3] || name === "br" || name === "hr") { b.add(tag.from, tag.to, meta); continue; }
      stack.push({ name, from: tag.from, to: tag.to, attrs: parseAttributes(open[2]) });
      continue;
    }
    if (!close) continue;
    const name = close[1].toLowerCase();
    const index = stack.map(entry => entry.name).lastIndexOf(name);
    if (index < 0) { b.add(tag.from, tag.to, meta); continue; }
    const start = stack[index];
    stack.length = index;
    const cls = htmlTagClasses[name];
    const active = isActive(b.state, start.from, tag.to);
    if (active || !cls) { b.add(start.from, start.to, meta); b.add(tag.from, tag.to, meta); }
    else { b.hide(start.from, start.to); b.hide(tag.from, tag.to); }
    if (!cls) continue;
    const attributes: Record<string, string> = {};
    let style = start.attrs.style ? safeStyle(start.attrs.style) : "";
    if (name === "font") {
      if (start.attrs.color) style += `;color:${start.attrs.color.replace(/[;"]/g, "")}`;
      if (start.attrs.face) style += `;font-family:${start.attrs.face.replace(/[;"]/g, "")}`;
    }
    if (style) attributes.style = style;
    if (name === "a" && start.attrs.href) attributes["data-href"] = start.attrs.href;
    b.add(start.to, tag.from, Decoration.mark({ class: cls, attributes }));
  }
  for (const entry of stack) b.add(entry.from, entry.to, meta);
}

function handleQuote(b: Builder, node: SyntaxNodeRef) {
  // Only the outermost quote assigns line classes; depth comes from the marks.
  for (let parent = node.node.parent; parent; parent = parent.parent) if (parent.name === "Blockquote") return;
  const doc = b.state.doc;
  const first = doc.lineAt(node.from), last = doc.lineAt(node.to);
  const alert = /^[ \t]*>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i.exec(first.text);
  const alertClass = alert ? ` md-alert md-alert-${alert[1].toLowerCase()}` : "";
  for (let n = first.number; n <= last.number; n++) {
    const line = doc.line(n);
    const depth = Math.max(1, (/^(?:[ \t]*>[ \t]?)*/.exec(line.text)![0].match(/>/g) || []).length);
    let cls = `md-quote md-quote-${Math.min(depth, 4)}` + alertClass;
    if (n === first.number) cls += " md-quote-first";
    if (n === last.number) cls += " md-quote-last";
    b.line(line.from, cls);
  }
  if (alert && !isLineActive(b.state, first.from, first.from)) {
    const at = first.text.indexOf("[!");
    const end = first.text.indexOf("]", at) + 1;
    b.add(first.from + at, first.from + end, Decoration.replace({ widget: new AlertLabelWidget(alert[1].toUpperCase()) }));
  }
}

function handleListMark(b: Builder, node: SyntaxNodeRef) {
  const item = node.node.parent;
  const list = item?.parent;
  if (!item || !list) return;
  const doc = b.state.doc;
  const line = doc.lineAt(node.from);
  const depth = listDepth(item);
  const lineStart = Math.max(line.from, (() => {
    // Start of indentation after any quote marks on this line.
    const quote = /^(?:[ \t]*>[ \t]?)*/.exec(line.text)![0];
    return line.from + quote.length;
  })());
  b.hide(lineStart, node.from, true);
  const afterMark = Math.min(node.to + 1, line.to);
  const markText = slice(b.state, node);
  const task = item.getChild("Task")?.getChild("TaskMarker") ?? null;
  let kind = "ul";
  if (task && task.from >= node.to && doc.lineAt(task.from).number === line.number) {
    const checked = /x/i.test(slice(b.state, task));
    const end = Math.min(task.to + (doc.sliceString(task.to, task.to + 1) === " " ? 1 : 0), line.to);
    b.add(node.from, end, Decoration.replace({ widget: new CheckboxWidget(checked, task.from) }));
    b.atomic.push({ from: node.from, to: end });
    kind = checked ? "task md-task-done" : "task";
  } else if (list.name === "OrderedList") {
    const firstMark = list.firstChild?.getChild("ListMark");
    const start = firstMark ? parseInt(slice(b.state, firstMark), 10) || 0 : 1;
    let index = 0;
    for (let sibling = item.prevSibling; sibling; sibling = sibling.prevSibling) if (sibling.name === "ListItem") index++;
    const label = `${start + index}${markText.slice(-1)}`;
    b.add(node.from, afterMark, Decoration.replace({ widget: new OrderedWidget(label) }));
    b.atomic.push({ from: node.from, to: afterMark });
    kind = "ol";
  } else {
    b.add(node.from, afterMark, Decoration.replace({ widget: new BulletWidget(depth) }));
    b.atomic.push({ from: node.from, to: afterMark });
  }
  b.line(line.from, `md-li md-li-${kind}`, { style: `--md-list-depth:${depth}` });
}

function handleListContinuation(b: Builder, node: SyntaxNodeRef) {
  const item = node.node.parent;
  if (!item || item.name !== "ListItem") return;
  const doc = b.state.doc;
  const itemLine = doc.lineAt(item.from).number;
  const first = doc.lineAt(node.from).number, last = doc.lineAt(node.to).number;
  const depth = listDepth(item);
  for (let n = Math.max(first, itemLine + 1); n <= last; n++) {
    const line = doc.line(n);
    const quote = /^(?:[ \t]*>[ \t]?)*/.exec(line.text)![0].length;
    const indent = /^[ \t]*/.exec(line.text.slice(quote))![0].length;
    b.hide(line.from + quote, line.from + quote + indent, true);
    b.line(line.from, "md-li-cont", { style: `--md-list-depth:${depth}` });
  }
}

function build(view: EditorView) {
  const state = view.state;
  const b = new Builder(state);
  const doc = state.doc;
  const ranges = view.visibleRanges;
  if (!ranges.length) return { decorations: Decoration.none, atomic: RangeSet.empty };
  const from = ranges[0].from, to = ranges[ranges.length - 1].to;
  syntaxTree(state).iterate({
    from, to,
    enter(node) {
      const name = node.name;
      if (blockSkip.has(name)) return false;
      if (inlineStyles[name]) { handleInlineStyle(b, node); return true; }
      switch (name) {
        case "ATXHeading1": case "ATXHeading2": case "ATXHeading3": case "ATXHeading4": case "ATXHeading5": case "ATXHeading6": {
          const level = name.slice(-1);
          b.line(node.from, `md-heading md-h${level}`);
          const marks = node.node.getChildren("HeaderMark");
          const line = doc.lineAt(node.from);
          if (marks[0]) {
            let end = marks[0].to;
            while (end < line.to && /[ \t]/.test(doc.sliceString(end, end + 1))) end++;
            b.hide(marks[0].from, end, true);
          }
          if (marks.length > 1 && !isLineActive(state, node.from, node.to)) {
            const close = marks[marks.length - 1];
            let start = close.from;
            while (start > line.from && /[ \t]/.test(doc.sliceString(start - 1, start))) start--;
            b.hide(start, close.to);
          }
          handleHtmlTags(b, node);
          return true;
        }
        case "SetextHeading1": case "SetextHeading2": {
          const level = name.slice(-1);
          const underline = node.node.getChild("HeaderMark");
          const firstLine = doc.lineAt(node.from).number;
          const lastLine = underline ? doc.lineAt(underline.from).number - 1 : doc.lineAt(node.to).number;
          for (let n = firstLine; n <= lastLine; n++) b.line(doc.line(n).from, `md-heading md-h${level}`);
          if (underline) {
            if (isLineActive(state, node.from, node.to)) b.line(underline.from, "md-setext-underline-active");
            else { b.line(underline.from, "md-setext-underline"); b.hide(underline.from, underline.to); }
          }
          handleHtmlTags(b, node);
          return true;
        }
        case "Paragraph": {
          const parent = node.node.parent?.name;
          if (parent === "Document" || parent === "Blockquote") {
            const first = doc.lineAt(node.from).number, last = doc.lineAt(node.to).number;
            for (let n = first; n <= last; n++) b.line(doc.line(n).from, "md-p");
          } else if (parent === "ListItem") handleListContinuation(b, node);
          handleHtmlTags(b, node);
          return true;
        }
        case "Blockquote": handleQuote(b, node); return true;
        case "QuoteMark": {
          let end = node.to;
          if (doc.sliceString(end, end + 1) === " ") end++;
          b.hide(node.from, end, true);
          return false;
        }
        case "ListMark": handleListMark(b, node); return false;
        case "TaskMarker": return false;
        case "Link": handleLink(b, node); return true;
        case "Image": handleImage(b, node); return false;
        case "Autolink": {
          const url = node.node.getChild("URL");
          const href = url ? slice(state, url) : "";
          b.add(url?.from ?? node.from, url?.to ?? node.to, Decoration.mark({ class: "md-link", attributes: { "data-href": href } }));
          for (const mark of node.node.getChildren("LinkMark")) {
            if (isActive(state, node.from, node.to)) b.add(mark.from, mark.to, meta); else b.hide(mark.from, mark.to);
          }
          return false;
        }
        case "URL": {
          const parent = node.node.parent?.name;
          if (parent === "Paragraph" || parent?.startsWith("ATXHeading") || parent === "TableCell" || parent === "Emphasis" || parent === "StrongEmphasis") {
            const href = slice(state, node);
            b.add(node.from, node.to, Decoration.mark({ class: "md-link", attributes: { "data-href": /^www\./i.test(href) ? "https://" + href : href } }));
          }
          return false;
        }
        case "InlineMath": {
          const tex = doc.sliceString(node.from + 1, node.to - 1);
          if (isActive(state, node.from, node.to)) {
            b.add(node.from, node.to, Decoration.mark({ class: "md-math-source" }));
            b.add(node.to, node.to, Decoration.widget({ widget: new MathWidget(tex, false, true), side: 1 }));
          } else b.add(node.from, node.to, Decoration.replace({ widget: new MathWidget(tex, false) }));
          return false;
        }
        case "FootnoteReference": {
          const label = slice(state, node).slice(2, -1);
          if (isActive(state, node.from, node.to)) b.add(node.from, node.to, Decoration.mark({ class: "md-footnote-source" }));
          else b.add(node.from, node.to, Decoration.replace({ widget: new FootnoteRefWidget(label, b.notes.text.get(label) ?? "", b.notes.index.get(label) ?? 0) }));
          return false;
        }
        case "FootnoteDefinition": {
          const first = doc.lineAt(node.from).number, last = doc.lineAt(node.to).number;
          for (let n = first; n <= last; n++) b.line(doc.line(n).from, "md-footnote-def");
          for (const mark of [...node.node.getChildren("FootnoteMark"), ...node.node.getChildren("FootnoteLabel")]) b.add(mark.from, mark.to, Decoration.mark({ class: "md-footnote-label" }));
          return true;
        }
        case "Emoji": {
          const text = slice(state, node);
          const emoji = (emojiNames as Record<string, string>)[text.slice(1, -1)];
          if (emoji && !isActive(state, node.from, node.to)) b.add(node.from, node.to, Decoration.replace({ widget: new EmojiWidget(emoji, text.slice(1, -1)) }));
          return false;
        }
        case "Escape":
          if (!isActive(state, node.from, node.to)) b.hide(node.from, node.from + 1);
          return false;
        case "LinkReference": {
          const first = doc.lineAt(node.from).number, last = doc.lineAt(node.to).number;
          for (let n = first; n <= last; n++) b.line(doc.line(n).from, "md-linkref");
          return false;
        }
        case "HTMLTag": case "Comment": return false;
        default: return true;
      }
    },
  });
  const atomicBuilder = new RangeSetBuilder<Decoration>();
  b.atomic.sort((x, y) => x.from - y.from || x.to - y.to);
  let last = -1;
  for (const range of b.atomic) {
    if (range.from < last) continue;
    atomicBuilder.add(range.from, range.to, hidden);
    last = range.to;
  }
  return { decorations: Decoration.set(b.ranges, true), atomic: atomicBuilder.finish() };
}

export const inlinePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  atomic: RangeSet<Decoration>;
  constructor(view: EditorView) {
    ({ decorations: this.decorations, atomic: this.atomic } = build(view));
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet ||
      syntaxTree(update.state) !== syntaxTree(update.startState) ||
      update.transactions.some(tr => tr.effects.some(effect => effect.is(setFocused) || effect.is(refreshDecorations)))) {
      ({ decorations: this.decorations, atomic: this.atomic } = build(update.view));
    }
  }
}, {
  decorations: plugin => plugin.decorations,
  provide: plugin => EditorView.atomicRanges.of(view => view.plugin(plugin)?.atomic ?? RangeSet.empty),
});
