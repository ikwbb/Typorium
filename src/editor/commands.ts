// Editing commands behind Typora's Paragraph / Format / Edit menus. They all
// operate on the Markdown source, so they behave the same in live and source
// mode and produce Typora-compatible Markdown.
import { EditorSelection, EditorState, type ChangeSpec, type SelectionRange, type StateCommand, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { insertNewlineContinueMarkupCommand, deleteMarkupBackward } from "@codemirror/lang-markdown";
import { insertNewlineAndIndent, selectLine as cmSelectLine } from "@codemirror/commands";
import { newTableSource, splitRow, serializeTable, parseTable } from "./table";

type ViewCommand = (view: EditorView) => boolean;

const codeLike = new Set(["FencedCode", "CodeBlock", "BlockMath", "HTMLBlock", "CommentBlock", "FrontMatter"]);

export function nodeAt(state: EditorState, pos: number, names: Set<string> | string[], side: -1 | 0 | 1 = 0): SyntaxNode | null {
  const set = names instanceof Set ? names : new Set(names);
  for (const s of side ? [side] : [-1, 1] as const) {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, s); node; node = node.parent)
      if (set.has(node.name)) return node;
  }
  return null;
}

export function inCode(state: EditorState, pos: number) {
  return !!nodeAt(state, pos, codeLike);
}

const prefixPattern = /^((?:[ \t]*>[ \t]?)*)([ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?(#{1,6}[ \t]+)?/;

function linePrefix(text: string) {
  const match = prefixPattern.exec(text)!;
  return { quote: match[1], indent: match[2], list: match[3] ?? "", heading: match[4] ?? "", length: match[0].length };
}

function selectedLines(state: EditorState, range: SelectionRange) {
  const lines = [];
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n));
  return lines;
}

function dispatchChanges(view: EditorView, changes: ChangeSpec[], userEvent: string) {
  if (!changes.length) return false;
  view.dispatch(view.state.update({ changes, userEvent, scrollIntoView: true }));
  return true;
}

/* ---------- Headings ---------- */

export function setHeading(level: number): ViewCommand {
  return view => {
    const { state } = view;
    const changes: ChangeSpec[] = [];
    for (const range of state.selection.ranges) for (const line of selectedLines(state, range)) {
      if (inCode(state, line.from)) continue;
      const prefix = linePrefix(line.text);
      const start = line.from + prefix.quote.length + prefix.indent.length + prefix.list.length;
      const current = prefix.heading.trim().length;
      const target = current === level ? 0 : level;
      const insert = target ? "#".repeat(target) + " " : "";
      changes.push({ from: start, to: start + prefix.heading.length, insert });
      // A setext underline below would conflict; drop it.
      if (line.number < state.doc.lines) {
        const next = state.doc.line(line.number + 1);
        if (/^ {0,3}(=+|-+)\s*$/.test(next.text) && nodeAt(state, line.from, ["SetextHeading1", "SetextHeading2"]))
          changes.push({ from: line.to, to: next.to });
      }
    }
    return dispatchChanges(view, changes, "input.heading");
  };
}

export function shiftHeading(delta: -1 | 1): ViewCommand {
  // delta -1 = promote (h3 → h2), +1 = demote (h2 → h3).
  return view => {
    const { state } = view;
    const changes: ChangeSpec[] = [];
    for (const range of state.selection.ranges) for (const line of selectedLines(state, range)) {
      if (inCode(state, line.from)) continue;
      const prefix = linePrefix(line.text);
      const current = prefix.heading.trim().length;
      let next = current === 0 ? (delta < 0 ? 6 : 0) : current + delta;
      if (next > 6) next = 0;
      if (next < 1 && current !== 0 && delta < 0) next = 1;
      const start = line.from + prefix.quote.length + prefix.indent.length + prefix.list.length;
      changes.push({ from: start, to: start + prefix.heading.length, insert: next ? "#".repeat(next) + " " : "" });
    }
    return dispatchChanges(view, changes, "input.heading");
  };
}

/* ---------- Inline formats ---------- */

export interface InlineFormat { open: string; close: string; node?: string; markNode?: string }

export const formats: Record<string, InlineFormat> = {
  strong: { open: "**", close: "**", node: "StrongEmphasis", markNode: "EmphasisMark" },
  emphasis: { open: "*", close: "*", node: "Emphasis", markNode: "EmphasisMark" },
  underline: { open: "<u>", close: "</u>" },
  code: { open: "`", close: "`", node: "InlineCode", markNode: "CodeMark" },
  strike: { open: "~~", close: "~~", node: "Strikethrough", markNode: "StrikethroughMark" },
  highlight: { open: "==", close: "==", node: "Highlight", markNode: "HighlightMark" },
  superscript: { open: "^", close: "^", node: "Superscript", markNode: "SuperscriptMark" },
  subscript: { open: "~", close: "~", node: "Subscript", markNode: "SubscriptMark" },
  inlineMath: { open: "$", close: "$", node: "InlineMath", markNode: "InlineMathMark" },
  comment: { open: "<!-- ", close: " -->" },
  kbd: { open: "<kbd>", close: "</kbd>" },
};

export function toggleFormat(name: keyof typeof formats | string): ViewCommand {
  const format = formats[name];
  return view => {
    const { state } = view;
    const { open, close } = format;
    const transaction = state.changeByRange(range => {
      if (range.empty && format.node) {
        const node = nodeAt(state, range.head, [format.node]);
        if (node) {
          const marks = node.getChildren(format.markNode!);
          const first = marks[0], last = marks[marks.length - 1];
          if (first && last && first !== last) {
            return {
              changes: [{ from: first.from, to: first.to }, { from: last.from, to: last.to }],
              range: EditorSelection.cursor(range.head - (first.to - first.from)),
            };
          }
        }
      }
      const text = state.sliceDoc(range.from, range.to);
      const before = state.sliceDoc(range.from - open.length, range.from);
      const after = state.sliceDoc(range.to, range.to + close.length);
      if (!range.empty && before === open && after === close) {
        return {
          changes: [{ from: range.from - open.length, to: range.from }, { from: range.to, to: range.to + close.length }],
          range: EditorSelection.range(range.from - open.length, range.to - open.length),
        };
      }
      if (text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
        return {
          changes: { from: range.from, to: range.to, insert: text.slice(open.length, text.length - close.length) },
          range: EditorSelection.range(range.from, range.to - open.length - close.length),
        };
      }
      // Wrap; trim surrounding whitespace out of the markers like Typora does.
      const leading = /^\s*/.exec(text)![0].length, trailing = /\s*$/.exec(text)![0].length;
      const from = range.from + (range.empty ? 0 : leading), to = range.to - (range.empty || leading === text.length ? 0 : trailing);
      return {
        changes: [{ from, insert: open }, { from: to, insert: close }],
        range: range.empty ? EditorSelection.cursor(from + open.length) : EditorSelection.range(from + open.length, to + open.length),
      };
    });
    view.dispatch(state.update(transaction, { userEvent: "input.format", scrollIntoView: true }));
    return true;
  };
}

export const insertLink: ViewCommand = view => {
  const { state } = view;
  const transaction = state.changeByRange(range => {
    const text = state.sliceDoc(range.from, range.to);
    if (/^(https?:\/\/|www\.)\S+$/i.test(text)) {
      const insert = `<${text}>`;
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) };
    }
    const link = nodeAt(state, range.head, ["Link"]);
    if (link && range.empty) {
      const marks = link.getChildren("LinkMark");
      if (marks.length >= 2) {
        const label = state.sliceDoc(marks[0].to, marks[1].from);
        return { changes: { from: link.from, to: link.to, insert: label }, range: EditorSelection.cursor(link.from + label.length) };
      }
    }
    const insert = `[${text}]()`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: text ? EditorSelection.cursor(range.from + insert.length - 1) : EditorSelection.cursor(range.from + 1),
    };
  });
  view.dispatch(state.update(transaction, { userEvent: "input.link", scrollIntoView: true }));
  return true;
};

export function insertImageMarkdown(view: EditorView, src: string, alt = "") {
  const { state } = view;
  const escaped = /[\s()]/.test(src) ? `<${src}>` : src;
  const transaction = state.changeByRange(range => {
    const label = alt || state.sliceDoc(range.from, range.to);
    const insert = `![${label}](${escaped})`;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) };
  });
  view.dispatch(state.update(transaction, { userEvent: "input.image", scrollIntoView: true }));
  return true;
}

const inlineNodes = new Set(["Emphasis", "StrongEmphasis", "Strikethrough", "Highlight", "InlineCode", "Subscript", "Superscript"]);
const inlineMarks = new Set(["EmphasisMark", "StrikethroughMark", "HighlightMark", "CodeMark", "SubscriptMark", "SuperscriptMark"]);

export const clearFormat: ViewCommand = view => {
  const { state } = view;
  const changes: { from: number; to: number }[] = [];
  for (const range of state.selection.ranges) {
    let from = range.from, to = range.to;
    if (range.empty) {
      const node = nodeAt(state, range.head, inlineNodes);
      if (!node) continue;
      from = node.from; to = node.to;
    }
    syntaxTree(state).iterate({
      from, to,
      enter(node) {
        if (inlineMarks.has(node.name) && node.node.parent && inlineNodes.has(node.node.parent.name)) {
          const parent = node.node.parent;
          if (parent.from >= from - 3 && parent.to <= to + 3) changes.push({ from: node.from, to: node.to });
        }
        if (node.name === "HTMLTag" && node.from >= from && node.to <= to) {
          const tag = state.sliceDoc(node.from, node.to);
          if (/^<\/?(u|ins|s|del|strike|mark|kbd|sub|sup|b|strong|i|em|small|big|span|font)\b[^>]*>$/i.test(tag)) changes.push({ from: node.from, to: node.to });
        }
      },
    });
  }
  const unique = [...new Map(changes.map(change => [`${change.from}:${change.to}`, change])).values()].sort((a, b) => a.from - b.from);
  return dispatchChanges(view, unique, "delete.format");
};

/* ---------- Block formats ---------- */

type ListKind = "bullet" | "ordered" | "task";

function listKind(list: string): ListKind | null {
  if (!list) return null;
  if (/\[[ xX]\]/.test(list)) return "task";
  return /^\d/.test(list) ? "ordered" : "bullet";
}

export function toggleList(kind: ListKind): ViewCommand {
  return view => {
    const { state } = view;
    const changes: ChangeSpec[] = [];
    for (const range of state.selection.ranges) {
      const lines = selectedLines(state, range).filter(line => !inCode(state, line.from));
      const content = lines.filter(line => line.text.trim() || lines.length === 1);
      const all = content.length > 0 && content.every(line => listKind(linePrefix(line.text).list) === kind);
      let counter = 1;
      for (const line of content) {
        const prefix = linePrefix(line.text);
        const start = line.from + prefix.quote.length + prefix.indent.length;
        const end = start + prefix.list.length + prefix.heading.length;
        let insert = "";
        if (!all) insert = kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${counter++}. `;
        changes.push({ from: start, to: end, insert });
      }
    }
    return dispatchChanges(view, changes, "input.list");
  };
}

export const toggleQuote: ViewCommand = view => {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  for (const range of state.selection.ranges) {
    const lines = selectedLines(state, range);
    const all = lines.every(line => /^\s*>/.test(line.text) || !line.text.trim());
    for (const line of lines) {
      if (all) {
        const match = /^(\s*)>[ \t]?/.exec(line.text);
        if (match) changes.push({ from: line.from + match[1].length, to: line.from + match[0].length });
      } else changes.push({ from: line.from, insert: line.text.trim() ? "> " : ">" });
    }
  }
  return dispatchChanges(view, changes, "input.quote");
};

export const toggleTask: ViewCommand = view => {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  for (const range of state.selection.ranges) for (const line of selectedLines(state, range)) {
    const match = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])\]/.exec(line.text);
    if (match) changes.push({ from: line.from + match[1].length, to: line.from + match[1].length + 1, insert: match[2] === " " ? "x" : " " });
  }
  return dispatchChanges(view, changes, "input.task");
};

export function setTaskStatus(done: boolean): ViewCommand {
  return view => {
    const { state } = view;
    const changes: ChangeSpec[] = [];
    for (const range of state.selection.ranges) for (const line of selectedLines(state, range)) {
      const match = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])\]/.exec(line.text);
      if (match) changes.push({ from: line.from + match[1].length, to: line.from + match[1].length + 1, insert: done ? "x" : " " });
    }
    return dispatchChanges(view, changes, "input.task");
  };
}

/** Indent/outdent list items by the width of their parent's marker (Typora's Tab in lists). */
export function indentList(direction: 1 | -1): ViewCommand {
  return view => {
    const { state } = view;
    const changes: ChangeSpec[] = [];
    for (const range of state.selection.ranges) {
      const lines = selectedLines(state, range);
      if (!lines.some(line => linePrefix(line.text).list)) return false;
      for (const line of lines) {
        const prefix = linePrefix(line.text);
        const at = line.from + prefix.quote.length;
        if (direction > 0) {
          // Width of the previous item's marker determines the nesting indent.
          let width = 2;
          for (let n = line.number - 1; n >= 1; n--) {
            const previous = linePrefix(state.doc.line(n).text);
            if (!state.doc.line(n).text.trim()) continue;
            if (previous.list && previous.indent.length <= prefix.indent.length) { width = previous.list.replace(/\[[ xX]\][ \t]+$/, "").length; break; }
            if (!previous.list && !previous.indent) break;
          }
          if (lines.length === 1 && line.number > 1 && !linePrefix(state.doc.line(line.number - 1).text).list && !state.doc.line(line.number - 1).text.startsWith(" ")) return false;
          changes.push({ from: at, insert: " ".repeat(width) });
        } else if (prefix.indent.length) {
          let width = Math.min(prefix.indent.length, 4);
          for (let n = line.number - 1; n >= 1; n--) {
            const previous = linePrefix(state.doc.line(n).text);
            if (previous.list && previous.indent.length < prefix.indent.length) { width = prefix.indent.length - previous.indent.length; break; }
          }
          changes.push({ from: at, to: at + width });
        }
      }
    }
    if (!changes.length) return direction < 0;
    return dispatchChanges(view, changes, direction > 0 ? "input.indent" : "delete.dedent");
  };
}

function insertBlock(view: EditorView, text: string, cursorOffset: number, userEvent = "input.block") {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const empty = !line.text.trim() && range.empty;
  let from = empty ? line.from : endLine.to;
  let before = empty ? "" : "\n\n";
  if (!empty && !endLine.text.trim()) { from = endLine.to; before = "\n"; }
  const nextLine = endLine.number < state.doc.lines ? state.doc.line(endLine.number + 1) : null;
  const after = nextLine && nextLine.text.trim() ? "\n" : "";
  const insert = before + text + after;
  view.dispatch({ changes: { from, to: empty ? line.to : from, insert }, selection: EditorSelection.cursor(from + before.length + cursorOffset), userEvent, scrollIntoView: true });
  return true;
}

export const insertCodeFence: ViewCommand = view => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) {
    const from = state.doc.lineAt(range.from).from, to = state.doc.lineAt(range.to).to;
    const body = state.sliceDoc(from, to);
    view.dispatch({ changes: { from, to, insert: "```\n" + body + "\n```" }, selection: EditorSelection.cursor(from + 3), userEvent: "input.block" });
    return true;
  }
  return insertBlock(view, "```\n\n```", 4);
};

export const insertMathBlock: ViewCommand = view => insertBlock(view, "$$\n\n$$", 3);
export const insertHorizontalRule: ViewCommand = view => insertBlock(view, "---\n", 4);
export const insertToc: ViewCommand = view => insertBlock(view, "[TOC]\n", 6);

export function insertTable(view: EditorView, rows = 2, columns = 3) {
  insertBlock(view, newTableSource(rows, columns) + "\n", 0, "input.table");
  focusTableAt(view, view.state.selection.main.head, 0, 0);
  return true;
}

/** Focus a table cell after the table widget is drawn. */
export function focusTableAt(view: EditorView, pos: number, row: number, col: number) {
  const attempt = () => {
    const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
    for (const wrap of view.contentDOM.querySelectorAll<HTMLElement>(".md-table-wrap")) {
      let at: number;
      try { at = view.posAtDOM(wrap); } catch { continue; }
      if (Math.abs(at - line.from) > 2) continue;
      const cell = (wrap.querySelector("table") as HTMLTableElement | null)?.rows[row]?.cells[col];
      if (cell) { cell.focus(); return true; }
    }
    return false;
  };
  if (!attempt()) requestAnimationFrame(attempt);
}

export const insertFrontMatter: ViewCommand = view => {
  const { state } = view;
  if (/^---\s*\n/.test(state.sliceDoc(0, 5))) {
    view.dispatch({ selection: EditorSelection.cursor(4), scrollIntoView: true });
    return true;
  }
  view.dispatch({ changes: { from: 0, insert: "---\n\n---\n\n" }, selection: EditorSelection.cursor(4), userEvent: "input.frontmatter", scrollIntoView: true });
  return true;
};

export const insertFootnote: ViewCommand = view => {
  const { state } = view;
  const source = state.doc.toString();
  const used = new Set([...source.matchAll(/\[\^(\d+)\]/g)].map(match => Number(match[1])));
  let n = 1;
  while (used.has(n)) n++;
  const ref = `[^${n}]`;
  const pos = state.selection.main.to;
  const tail = source.endsWith("\n\n") ? "" : source.endsWith("\n") ? "\n" : "\n\n";
  const definition = `${tail}${ref}: `;
  view.dispatch({
    changes: [{ from: pos, insert: ref }, { from: state.doc.length, insert: definition }],
    selection: EditorSelection.cursor(state.doc.length + ref.length + definition.length),
    userEvent: "input.footnote", scrollIntoView: true,
  });
  return true;
};

export const insertLinkReference: ViewCommand = view => insertBlock(view, "[label]: https://", 1);

export function insertParagraph(where: "before" | "after"): ViewCommand {
  return view => {
    const { state } = view;
    const pos = state.selection.main.head;
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    while (node && node.parent && node.parent.name !== "Document") node = node.parent;
    const from = node && node.name !== "Document" ? node.from : state.doc.lineAt(pos).from;
    const to = node && node.name !== "Document" ? node.to : state.doc.lineAt(pos).to;
    if (where === "before") {
      const at = state.doc.lineAt(from).from;
      view.dispatch({ changes: { from: at, insert: "\n\n" }, selection: EditorSelection.cursor(at), userEvent: "input", scrollIntoView: true });
    } else {
      const at = state.doc.lineAt(to).to;
      view.dispatch({ changes: { from: at, insert: "\n\n" }, selection: EditorSelection.cursor(at + 2), userEvent: "input", scrollIntoView: true });
    }
    return true;
  };
}

/* ---------- Selection ---------- */

export const selectLine: ViewCommand = view => cmSelectLine(view);

export const selectWord: ViewCommand = view => {
  const { state } = view;
  const ranges = state.selection.ranges.map(range => {
    const word = state.wordAt(range.head);
    return word ? EditorSelection.range(word.from, word.to) : range;
  });
  view.dispatch({ selection: EditorSelection.create(ranges, state.selection.mainIndex) });
  return true;
};

/** Typora's "Select Styled Scope" (Mod-E): inline element, then its block. */
export const selectScope: ViewCommand = view => {
  const { state } = view;
  const range = state.selection.main;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(range.head, -1); node; node = node.parent) {
    if (node.name === "Document") break;
    if (node.from < range.from || node.to > range.to) {
      if (node.from <= range.from && node.to >= range.to && !(node.from === range.from && node.to === range.to)) {
        view.dispatch({ selection: EditorSelection.range(node.from, node.to) });
        return true;
      }
    }
  }
  return false;
};

export const deleteWord: ViewCommand = view => {
  const { state } = view;
  const word = state.wordAt(state.selection.main.head);
  if (!word) return false;
  view.dispatch({ changes: { from: word.from, to: word.to }, userEvent: "delete.word" });
  return true;
};

/* ---------- Typora Enter / Backspace behaviour ---------- */

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

function enterInTableHeader(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to) return false;
  const match = /^((?:[ \t]*>[ \t]?)*)([ \t]*\|.*\|[ \t]*)$/.exec(line.text);
  if (!match || nodeAt(state, line.from, ["Table", "FencedCode", "CodeBlock", "BlockMath", "HTMLBlock"])) return false;
  const cells = splitRow(match[2]);
  if (cells.length < 2 && !/^\s*\|.*\|.*\|\s*$/.test(match[2])) return false;
  const columns = Math.max(1, cells.length);
  const model = parseTable([match[2], Array(columns).fill("---").join("|")]);
  model.rows.push(Array(columns).fill(""));
  const insert = serializeTable(model, match[1]);
  view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: EditorSelection.cursor(line.from), userEvent: "input.table" });
  focusTableAt(view, line.from, 1, 0);
  return true;
}

function enterAutoCloseBlock(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to) return false;
  const fence = /^((?:[ \t]*>[ \t]?)*[ \t]*)(`{3,}|~{3,})([^`]*)$/.exec(line.text);
  const math = /^((?:[ \t]*>[ \t]?)*[ \t]*)\$\$[ \t]*$/.exec(line.text);
  if (fence) {
    const node = nodeAt(state, line.from + fence[1].length, ["FencedCode"], 1);
    if (node && node.getChildren("CodeMark").length > 1) return false;
    const prefix = fence[1];
    const insert = "\n" + prefix + "\n" + prefix + fence[2];
    view.dispatch({ changes: { from: line.to, insert }, selection: EditorSelection.cursor(line.to + 1 + prefix.length), userEvent: "input.block" });
    return true;
  }
  if (math) {
    const node = nodeAt(state, line.from + math[1].length, ["BlockMath"], 1);
    if (node && node.getChildren("BlockMathMark").length > 1) return false;
    const prefix = math[1];
    const insert = "\n" + prefix + "\n" + prefix + "$$";
    view.dispatch({ changes: { from: line.to, insert }, selection: EditorSelection.cursor(line.to + 1 + prefix.length), userEvent: "input.block" });
    return true;
  }
  return false;
}

/** Enter in a paragraph starts a new paragraph (blank line), like Typora. */
function enterParagraph(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.from);
  if (!line.text.trim()) return false;
  const node = nodeAt(state, range.from, ["Paragraph", "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6", "SetextHeading1", "SetextHeading2", "Blockquote", "ListItem", "FencedCode", "CodeBlock", "BlockMath", "HTMLBlock", "Table", "FrontMatter", "FootnoteDefinition", "LinkReference", "CommentBlock"]);
  if (!node || !["Paragraph", "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6"].includes(node.name)) return false;
  if (node.parent && node.parent.name !== "Document") return false;
  // Enter at the very start of a heading pushes it down instead of splitting.
  const prefix = linePrefix(line.text);
  if (node.name.startsWith("ATX") && range.empty && range.from === line.from + prefix.length && line.to > range.from) {
    view.dispatch({ changes: { from: line.from, insert: "\n\n" }, selection: EditorSelection.cursor(line.from + 2 + prefix.length), userEvent: "input", scrollIntoView: true });
    return true;
  }
  const before = state.sliceDoc(line.from, range.from).replace(/[ \t]+$/, "");
  const trimFrom = line.from + before.length;
  let afterStart = range.to;
  while (afterStart < line.to && /[ \t]/.test(state.sliceDoc(afterStart, afterStart + 1))) afterStart++;
  view.dispatch({
    changes: { from: trimFrom, to: afterStart, insert: "\n\n" },
    selection: EditorSelection.cursor(trimFrom + 2),
    userEvent: "input", scrollIntoView: true,
  });
  return true;
}

function enterInQuote(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  const match = /^((?:[ \t]*>[ \t]?)+)(.*)$/.exec(line.text);
  if (!match || nodeAt(state, range.head, ["ListItem", "FencedCode", "BlockMath", "Table", "HTMLBlock"])) return false;
  const quote = match[1].replace(/[ \t]*$/, "");
  const prefix = quote + " ";
  if (!match[2].trim()) {
    // Empty quoted line: leave one quote level (and the quote entirely at level one).
    const levels = (quote.match(/>/g) || []).length;
    if (levels > 1) {
      const reduced = "> ".repeat(levels - 1);
      view.dispatch({ changes: { from: line.from, to: line.to, insert: reduced }, selection: EditorSelection.cursor(line.from + reduced.length), userEvent: "input" });
      return true;
    }
    const prev = line.number > 1 ? state.doc.line(line.number - 1) : null;
    const from = prev && /^[ \t]*>[ \t]*$/.test(prev.text) ? prev.from : line.from;
    view.dispatch({ changes: { from, to: line.to, insert: "\n" }, selection: EditorSelection.cursor(from + 1), userEvent: "input", scrollIntoView: true });
    return true;
  }
  const headLen = range.head - line.from;
  if (headLen < match[1].length) return false;
  let afterStart = range.head;
  while (afterStart < line.to && state.sliceDoc(afterStart, afterStart + 1) === " ") afterStart++;
  const insert = "\n" + quote + "\n" + prefix;
  view.dispatch({ changes: { from: range.head, to: afterStart, insert }, selection: EditorSelection.cursor(range.head + insert.length), userEvent: "input", scrollIntoView: true });
  return true;
}

/** Enter on an empty list item: outdent a nested item, or leave the list with a blank line. */
function enterEmptyListItem(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  const prefix = linePrefix(line.text);
  if (!prefix.list || line.text.slice(prefix.length - prefix.heading.length).trim() || range.head !== line.to) return false;
  if (inCode(state, line.from)) return false;
  if (prefix.indent.length) return indentList(-1)(view);
  const quote = prefix.quote;
  const insert = quote.trimEnd() + "\n" + quote;
  view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: EditorSelection.cursor(line.from + insert.length), userEvent: "input", scrollIntoView: true });
  return true;
}

export const typoraEnter: ViewCommand = view =>
  enterAutoCloseBlock(view) || enterInTableHeader(view) || enterEmptyListItem(view) || enterInQuote(view) || enterParagraph(view) ||
  continueMarkup(view) || insertNewlineAndIndent(view);

const blockContainers = ["FencedCode", "BlockMath", "HTMLBlock", "Blockquote", "FrontMatter", "CommentBlock", "ListItem", "Table"];

/** Arrow keys past the first/last line of a block at the document edge add an empty paragraph. */
export function arrowPastEdge(direction: 1 | -1): ViewCommand {
  return view => {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty || state.selection.ranges.length > 1) return false;
    const line = state.doc.lineAt(range.head);
    if (direction > 0 ? line.number !== state.doc.lines : line.number !== 1) return false;
    if (!nodeAt(state, direction > 0 ? line.to : line.from, blockContainers, direction > 0 ? -1 : 1)) return false;
    // Only when the caret is visually on the edge line (wrapped lines move within it first).
    const moved = view.moveVertically(range, direction > 0);
    if (moved.head !== range.head && state.doc.lineAt(moved.head).number === line.number && moved.head !== (direction > 0 ? line.to : line.from)) return false;
    if (direction > 0) view.dispatch({ changes: { from: state.doc.length, insert: "\n\n" }, selection: EditorSelection.cursor(state.doc.length + 2), scrollIntoView: true, userEvent: "input" });
    else view.dispatch({ changes: { from: 0, insert: "\n\n" }, selection: EditorSelection.cursor(0), scrollIntoView: true, userEvent: "input" });
    return true;
  };
}

export const softBreak: ViewCommand = view => {
  view.dispatch(view.state.replaceSelection("\n"), { userEvent: "input", scrollIntoView: true });
  return true;
};

/** Backspace at the start of a paragraph merges it into the previous one. */
export const typoraBackspace: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.from || line.number < 3) return false;
  const blank = state.doc.line(line.number - 1);
  if (blank.text.trim()) return false;
  const previous = state.doc.line(line.number - 2);
  if (!previous.text.trim()) return false;
  const here = nodeAt(state, line.from, ["Paragraph"], 1);
  const there = nodeAt(state, previous.to, ["Paragraph"], -1);
  if (!here || !there || here.parent?.name !== "Document" || there.parent?.name !== "Document") return false;
  dispatch(state.update({ changes: { from: previous.to, to: line.from }, selection: EditorSelection.cursor(previous.to), userEvent: "delete.backward", scrollIntoView: true }));
  return true;
};

export const typoraDelete: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to || line.number + 2 > state.doc.lines || !line.text.trim()) return false;
  const blank = state.doc.line(line.number + 1);
  const next = state.doc.line(line.number + 2);
  if (blank.text.trim() || !next.text.trim()) return false;
  const here = nodeAt(state, line.to, ["Paragraph"], -1);
  const there = nodeAt(state, next.from, ["Paragraph"], 1);
  if (!here || !there || here.parent?.name !== "Document" || there.parent?.name !== "Document") return false;
  dispatch(state.update({ changes: { from: line.to, to: next.from }, userEvent: "delete.forward" }));
  return true;
};

export { deleteMarkupBackward };

/** Typing a Markdown delimiter over a selection wraps it (Typora's auto-pair). */
export const wrapSelectionOnType = EditorView.inputHandler.of((view, from, to, text) => {
  if (from === to || view.state.selection.ranges.length > 1) return false;
  const pairs: Record<string, [string, string]> = {
    "*": ["*", "*"], "_": ["_", "_"], "`": ["`", "`"], "~": ["~", "~"], "=": ["==", "=="], "$": ["$", "$"],
    "(": ["(", ")"], "[": ["[", "]"], "{": ["{", "}"], '"': ['"', '"'], "'": ["'", "'"], "<": ["<", ">"],
  };
  const pair = pairs[text];
  if (!pair || view.composing) return false;
  const range = view.state.selection.main;
  if (range.from !== from || range.to !== to) return false;
  view.dispatch({
    changes: [{ from, insert: pair[0] }, { from: to, insert: pair[1] }],
    selection: EditorSelection.range(from + pair[0].length, to + pair[0].length),
    userEvent: "input.type",
    annotations: Transaction.addToHistory.of(true),
  });
  return true;
});
