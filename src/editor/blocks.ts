// Block-level live preview: code fences, math blocks, diagrams, tables, HTML
// blocks, front matter, horizontal rules and [TOC]. Block widgets that replace
// whole lines must come from a StateField, so these live here rather than in
// the inline view plugin.
import { StateField, EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";
import { isActive, isLineActive, refreshDecorations, setFocused } from "./state";
import { MathWidget, DiagramWidget, HtmlWidget, TocWidget, HrWidget, type TocEntry } from "./widgets";
import { TableWidget } from "./table";
import { diagramLanguages } from "../render/diagrams";

class CodeHeaderWidget extends WidgetType {
  constructor(readonly language: string, readonly code: string) { super(); }
  eq(other: CodeHeaderWidget) { return other.language === this.language && other.code === this.code; }
  toDOM(view: EditorView) {
    const header = document.createElement("span");
    header.className = "md-code-header";
    const input = document.createElement("input");
    input.className = "md-code-lang";
    input.value = this.language;
    input.placeholder = "language";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Code language");
    input.setAttribute("autocapitalize", "off");
    const commit = () => {
      const pos = view.posAtDOM(header);
      const line = view.state.doc.lineAt(pos);
      const match = /^(\s*(?:>\s?)*\s*(?:`{3,}|~{3,}))(.*)$/.exec(line.text);
      if (!match) return;
      const value = input.value.trim();
      if (value === match[2].trim()) return;
      view.dispatch({ changes: { from: line.from + match[1].length, to: line.to, insert: value }, userEvent: "input.codelang" });
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === "ArrowDown") {
        event.preventDefault();
        commit();
        const line = view.state.doc.lineAt(view.posAtDOM(header));
        const next = Math.min(line.to + 1, view.state.doc.length);
        view.dispatch({ selection: { anchor: next } });
        view.focus();
      } else if (event.key === "Escape") { input.value = this.language; view.focus(); }
    });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "md-code-copy";
    copy.textContent = "Copy";
    copy.title = "Copy code";
    copy.addEventListener("mousedown", event => event.preventDefault());
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(this.code).then(() => {
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy"; }, 1200);
      });
    });
    header.append(input, copy);
    return header;
  }
  ignoreEvent() { return true; }
}

function stripPrefixes(text: string, inQuote: boolean) {
  return inQuote ? text.split("\n").map(line => line.replace(/^\s*(?:>\s?)+/, "")).join("\n") : text;
}

function headingText(state: EditorState, node: SyntaxNodeRef) {
  const text = state.doc.sliceString(node.from, node.to);
  if (node.name.startsWith("SetextHeading")) return text.split("\n")[0].trim();
  return text.replace(/^\s*#{1,6}[ \t]*/, "").replace(/[ \t]+#+[ \t]*$/, "").trim();
}

export function collectHeadings(state: EditorState): TocEntry[] {
  const entries: TocEntry[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      const match = /^(?:ATXHeading(\d)|SetextHeading(\d))$/.exec(node.name);
      if (match) { entries.push({ level: Number(match[1] || match[2]), text: headingText(state, node), pos: node.from }); return false; }
      return ["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"].includes(node.name);
    },
  });
  return entries;
}

function inQuote(node: SyntaxNodeRef) {
  for (let parent = node.node.parent; parent; parent = parent.parent) if (parent.name === "Blockquote") return true;
  return false;
}

function buildBlocks(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const doc = state.doc;
  const tocLines: number[] = [];
  const replaceLines = (from: number, to: number, widget: WidgetType) =>
    ranges.push(Decoration.replace({ widget, block: true }).range(doc.lineAt(from).from, doc.lineAt(to).to));
  const lineClass = (from: number, to: number, cls: (index: number, count: number, lineFrom: number) => string) => {
    const first = doc.lineAt(from).number, last = doc.lineAt(to).number;
    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      const name = cls(n - first, last - first + 1, line.from);
      if (name) ranges.push(Decoration.line({ class: name }).range(line.from));
    }
  };

  syntaxTree(state).iterate({
    enter(node) {
      switch (node.name) {
        case "Document": case "Blockquote": case "BulletList": case "OrderedList": case "ListItem":
          return true;
        case "FencedCode": {
          const marks = node.node.getChildren("CodeMark");
          const infoNode = node.node.getChild("CodeInfo");
          const info = infoNode ? doc.sliceString(infoNode.from, infoNode.to) : "";
          const language = info.trim().split(/\s+/)[0].toLowerCase();
          const firstLine = doc.lineAt(node.from), lastLine = doc.lineAt(node.to);
          const closed = marks.length > 1 && lastLine.number > firstLine.number;
          const bodyFrom = Math.min(firstLine.to + 1, node.to);
          const bodyTo = closed ? Math.max(bodyFrom, lastLine.from - 1) : node.to;
          const code = stripPrefixes(doc.sliceString(bodyFrom, bodyTo), inQuote(node));
          const active = isLineActive(state, node.from, node.to);
          if (diagramLanguages.has(language) && !active && closed) {
            replaceLines(node.from, node.to, new DiagramWidget(language, code));
            return false;
          }
          const hideClose = !active && closed;
          const visibleLast = hideClose ? lastLine.number - 1 : lastLine.number;
          lineClass(node.from, node.to, (index, _count, lineFrom) => {
            const n = doc.lineAt(lineFrom).number;
            let cls = "md-fences cm-s-inner md-code-line";
            if (index === 0) cls += active ? " md-code-first md-code-fence" : " md-code-first md-code-header-line";
            if (n === visibleLast) cls += " md-code-last";
            if (active && closed && n === lastLine.number) cls += " md-code-fence";
            return cls;
          });
          if (!active) {
            ranges.push(Decoration.replace({ widget: new CodeHeaderWidget(info.trim(), code) }).range(node.from, firstLine.to));
            if (closed) ranges.push(Decoration.replace({}).range(lastLine.from - 1, lastLine.to));
          }
          if (diagramLanguages.has(language) && active)
            ranges.push(Decoration.widget({ widget: new DiagramWidget(language, code, true), block: true, side: 1 }).range(lastLine.to));
          return false;
        }
        case "BlockMath": {
          const marks = node.node.getChildren("BlockMathMark");
          const open = marks[0], close = marks.length > 1 ? marks[marks.length - 1] : null;
          const tex = stripPrefixes(doc.sliceString(open ? open.to : node.from, close ? close.from : node.to), inQuote(node)).trim();
          const active = isLineActive(state, node.from, node.to);
          if (!active) replaceLines(node.from, node.to, new MathWidget(tex, true));
          else {
            lineClass(node.from, node.to, () => "md-math-source");
            ranges.push(Decoration.widget({ widget: new MathWidget(tex, true, true), block: true, side: 1 }).range(doc.lineAt(node.to).to));
          }
          return false;
        }
        case "Table": {
          const firstLine = doc.lineAt(node.from), lastLine = doc.lineAt(node.to);
          const raw = doc.sliceString(firstLine.from, lastLine.to);
          const prefix = doc.sliceString(firstLine.from, node.from);
          if (lastLine.number - firstLine.number >= 1)
            ranges.push(Decoration.replace({ widget: new TableWidget(raw, prefix), block: true }).range(firstLine.from, lastLine.to));
          return false;
        }
        case "HTMLBlock": {
          const text = doc.sliceString(node.from, node.to);
          if (isLineActive(state, node.from, node.to) || /^\s*<!--/.test(text)) lineClass(node.from, node.to, () => "md-html-source");
          else replaceLines(node.from, node.to, new HtmlWidget(text));
          return false;
        }
        case "CommentBlock":
          lineClass(node.from, node.to, () => "md-comment");
          return false;
        case "FrontMatter":
          lineClass(node.from, node.to, (index, count) => "md-meta-block" + (index === 0 ? " md-meta-first" : "") + (index === count - 1 ? " md-meta-last" : ""));
          return false;
        case "HorizontalRule": {
          const line = doc.lineAt(node.from);
          ranges.push(Decoration.line({ class: "md-hr-line" }).range(line.from));
          if (!isLineActive(state, node.from, node.to)) ranges.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to));
          return false;
        }
        case "Paragraph": {
          if (/^\s*\[toc\]\s*$/i.test(doc.sliceString(node.from, node.to))) tocLines.push(node.from);
          return false;
        }
        default:
          return false;
      }
    },
  });

  if (tocLines.length) {
    const headings = collectHeadings(state);
    for (const pos of tocLines) {
      if (isActive(state, doc.lineAt(pos).from, doc.lineAt(pos).to)) continue;
      replaceLines(pos, pos, new TocWidget(headings));
    }
  }
  return Decoration.set(ranges, true);
}

export const blockDecorations = StateField.define<DecorationSet>({
  create: state => buildBlocks(state),
  update(value, tr) {
    const rebuild = tr.docChanged || tr.selection ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      tr.effects.some(effect => effect.is(setFocused) || effect.is(refreshDecorations));
    return rebuild ? buildBlocks(tr.state) : value;
  },
  provide: field => EditorView.decorations.from(field),
});
