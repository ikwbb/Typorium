// Typora-style table editing: a GFM pipe table is shown as a real grid whose
// cells are editable; every edit is written back to the Markdown source as one
// transaction, so undo/redo and source mode stay in sync.
import { WidgetType, EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { undo, redo } from "@codemirror/commands";
import { renderInline } from "../render/markdown";
import { renderMathIn } from "../render/math";
import { editorHost } from "./state";

export type Align = "left" | "center" | "right" | null;
export interface TableModel { rows: string[][]; align: Align[] }

export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  let codeTicks = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) { current += ch + text[i + 1]; i++; continue; }
    if (ch === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      if (codeTicks === 0) codeTicks = run; else if (codeTicks === run) codeTicks = 0;
      current += text.slice(i, i + run);
      i += run - 1;
      continue;
    }
    if (ch === "|" && codeTicks === 0) { cells.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

export function parseTable(lines: string[]): TableModel {
  const header = splitRow(lines[0] ?? "");
  const delimiter = splitRow(lines[1] ?? "");
  const width = header.length;
  const align: Align[] = [];
  for (let c = 0; c < width; c++) {
    const cell = (delimiter[c] || "").trim();
    const left = cell.startsWith(":"), right = cell.endsWith(":");
    align.push(left && right ? "center" : right ? "right" : left ? "left" : null);
  }
  const rows = [header];
  for (const line of lines.slice(2)) {
    const cells = splitRow(line);
    while (cells.length < width) cells.push("");
    rows.push(cells.slice(0, width));
  }
  return { rows, align };
}

const wide = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]|[\u{20000}-\u{3fffd}]/u;

export function displayWidth(text: string) {
  let width = 0;
  for (const ch of text) width += wide.test(ch) ? 2 : 1;
  return width;
}

const pad = (text: string, width: number, align: Align) => {
  const gap = Math.max(0, width - displayWidth(text));
  if (align === "right") return " ".repeat(gap) + text;
  if (align === "center") return " ".repeat(Math.floor(gap / 2)) + text + " ".repeat(Math.ceil(gap / 2));
  return text + " ".repeat(gap);
};

export function serializeTable(model: TableModel, prefix = ""): string {
  const columns = model.align.length;
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(3, ...model.rows.map(row => displayWidth(row[c] ?? ""))));
  const line = (cells: string[]) => prefix + "| " + cells.map((cell, c) => pad(cell ?? "", widths[c], model.align[c])).join(" | ") + " |";
  const delimiter = prefix + "| " + model.align.map((a, c) => {
    const dashes = "-".repeat(Math.max(1, widths[c] - (a === "center" ? 2 : a ? 1 : 0)));
    return a === "center" ? `:${dashes}:` : a === "left" ? `:${dashes}` : a === "right" ? `${dashes}:` : dashes;
  }).join(" | ") + " |";
  return [line(model.rows[0]), delimiter, ...model.rows.slice(1).map(line)].join("\n");
}

export function newTableSource(rows: number, columns: number) {
  const model: TableModel = {
    rows: Array.from({ length: rows + 1 }, () => Array(columns).fill("")),
    align: Array(columns).fill(null),
  };
  return serializeTable(model);
}

/** Escape characters typed into a cell that would break the table row. */
function escapeCell(text: string) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) { out += ch + text[i + 1]; i++; continue; }
    out += ch === "|" ? "\\|" : ch === "\n" ? "<br>" : ch;
  }
  return out.trim() === "" ? "" : out;
}

const plaintextSupported = (() => {
  const probe = document.createElement("div");
  probe.contentEditable = "plaintext-only";
  return probe.contentEditable === "plaintext-only";
})();

function placeCaret(element: HTMLElement, atEnd = true) {
  element.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(!atEnd);
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretOffsets(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length, length: element.textContent?.length ?? 0 };
}

interface Controller { update(widget: TableWidget): void }

export class TableWidget extends WidgetType {
  constructor(readonly raw: string, readonly prefix: string) { super(); }
  eq(other: TableWidget) { return other.raw === this.raw && other.prefix === this.prefix; }
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "md-table-wrap";
    (dom as unknown as { controller: Controller }).controller = new TableController(dom, view, this);
    return dom;
  }
  updateDOM(dom: HTMLElement) {
    const controller = (dom as unknown as { controller?: Controller }).controller;
    if (!controller) return false;
    controller.update(this);
    return true;
  }
  ignoreEvent() { return true; }
  get estimatedHeight() { return (this.raw.split("\n").length - 1) * 34; }
}

const icons: Record<string, string> = {
  left: '<svg viewBox="0 0 16 16"><path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h8"/></svg>',
  center: '<svg viewBox="0 0 16 16"><path d="M2 3h12M4 6.5h8M2 10h12M4 13.5h8"/></svg>',
  right: '<svg viewBox="0 0 16 16"><path d="M2 3h12M6 6.5h8M2 10h12M6 13.5h8"/></svg>',
};

class TableController implements Controller {
  model: TableModel;
  raw: string;
  prefix: string;
  table = document.createElement("table");
  toolbar = document.createElement("div");
  active: { row: number; col: number } | null = null;
  composing = false;

  constructor(readonly dom: HTMLElement, readonly view: EditorView, widget: TableWidget) {
    this.raw = widget.raw;
    this.prefix = widget.prefix;
    this.model = this.parse(widget.raw);
    this.table.className = "md-table";
    this.buildToolbar();
    dom.append(this.toolbar, this.table);
    this.render();
    dom.addEventListener("focusout", event => {
      if (!dom.contains(event.relatedTarget as Node)) { this.active = null; dom.classList.remove("md-table-focused"); }
    });
    dom.addEventListener("mousedown", event => {
      if (event.target === dom) { event.preventDefault(); this.exit(1); }
    });
  }

  parse(raw: string) {
    const lines = raw.split("\n").map(line => this.prefix && line.startsWith(this.prefix) ? line.slice(this.prefix.length) : line.replace(/^\s*(?:>\s?)*/, ""));
    return parseTable(lines);
  }

  update(widget: TableWidget) {
    if (widget.raw === this.raw && widget.prefix === this.prefix) return;
    const before = this.model;
    this.raw = widget.raw;
    this.prefix = widget.prefix;
    this.model = this.parse(widget.raw);
    const sameShape = before.rows.length === this.model.rows.length && before.align.length === this.model.align.length;
    if (sameShape && this.active) {
      // Refresh every cell except the one being typed in.
      this.model.rows.forEach((row, r) => row.forEach((cell, c) => {
        const element = this.cell(r, c);
        if (!element) return;
        if (r === this.active!.row && c === this.active!.col && document.activeElement === element) {
          if ((element.textContent ?? "") !== cell) { element.textContent = cell; placeCaret(element); }
        } else this.fill(element, cell, r, c);
      }));
      this.applyAlignment();
      return;
    }
    const focus = this.active;
    this.render();
    if (focus) this.focusCell(Math.min(focus.row, this.model.rows.length - 1), Math.min(focus.col, this.model.align.length - 1));
  }

  get range() {
    const from = this.view.posAtDOM(this.dom);
    return { from, to: Math.min(from + this.raw.length, this.view.state.doc.length) };
  }

  commit(userEvent = "input.table") {
    const next = serializeTable(this.model, this.prefix);
    if (next === this.raw) return;
    const { from, to } = this.range;
    this.raw = next;
    this.view.dispatch({ changes: { from, to, insert: next }, userEvent });
  }

  cell(row: number, col: number) {
    return this.table.rows[row]?.cells[col] as HTMLElement | undefined;
  }

  fill(element: HTMLElement, text: string, _row: number, _col: number) {
    if (document.activeElement === element) { element.textContent = text; return; }
    element.innerHTML = text ? renderInline(text) : "";
    for (const link of element.querySelectorAll("a")) link.addEventListener("click", event => event.preventDefault());
    const host = this.view.state.facet(editorHost);
    for (const img of element.querySelectorAll("img")) {
      const src = img.getAttribute("src") || "";
      const resolved = host.resolveImage(src);
      if (resolved instanceof Promise) resolved.then(url => { if (url) img.src = url; });
      else if (resolved) img.src = resolved;
    }
    if (element.querySelector("[data-math]")) renderMathIn(element);
  }

  render() {
    this.table.replaceChildren();
    const head = this.table.createTHead();
    const body = this.table.createTBody();
    this.model.rows.forEach((row, r) => {
      const tr = (r === 0 ? head : body).insertRow();
      row.forEach((cell, c) => {
        const element = document.createElement(r === 0 ? "th" : "td");
        element.contentEditable = plaintextSupported ? "plaintext-only" : "true";
        element.spellcheck = this.view.contentDOM.spellcheck;
        this.fill(element, cell, r, c);
        this.bindCell(element);
        tr.append(element);
      });
    });
    this.applyAlignment();
  }

  applyAlignment() {
    for (const tr of this.table.rows) [...tr.cells].forEach((cell, c) => {
      const align = this.model.align[c];
      if (align) cell.style.textAlign = align; else cell.style.removeProperty("text-align");
    });
  }

  position(element: HTMLElement) {
    const tr = element.parentElement as HTMLTableRowElement;
    return { row: tr.rowIndex, col: (element as HTMLTableCellElement).cellIndex };
  }

  bindCell(element: HTMLElement) {
    element.addEventListener("focus", () => {
      const { row, col } = this.position(element);
      this.active = { row, col };
      this.dom.classList.add("md-table-focused");
      const raw = this.model.rows[row][col];
      if (element.textContent !== raw || element.children.length) {
        element.textContent = raw;
        placeCaret(element);
      }
    });
    element.addEventListener("blur", () => {
      const { row, col } = this.position(element);
      if (this.model.rows[row]) this.fill(element, this.model.rows[row][col] ?? "", row, col);
    });
    element.addEventListener("compositionstart", () => { this.composing = true; });
    element.addEventListener("compositionend", () => { this.composing = false; this.read(element); });
    element.addEventListener("input", event => {
      if (this.composing || (event as InputEvent).isComposing) return;
      this.read(element);
    });
    element.addEventListener("paste", event => {
      event.preventDefault();
      const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\r?\n/g, " ");
      document.execCommand("insertText", false, text);
    });
    element.addEventListener("keydown", event => this.keydown(event, element));
  }

  read(element: HTMLElement) {
    const { row, col } = this.position(element);
    const text = (plaintextSupported ? element.textContent : element.innerText)?.replace(/ /g, " ") ?? "";
    this.model.rows[row][col] = escapeCell(text);
    this.commit();
  }

  focusCell(row: number, col: number, atEnd = true) {
    const element = this.cell(row, col);
    if (element) placeCaret(element, atEnd);
  }

  exit(direction: -1 | 1) {
    const { from, to } = this.range;
    const doc = this.view.state.doc;
    if (direction < 0) {
      if (from > 0) this.view.dispatch({ selection: EditorSelection.cursor(from - 1), scrollIntoView: true });
      else this.view.dispatch({ changes: { from: 0, insert: "\n" }, selection: EditorSelection.cursor(0), scrollIntoView: true });
    } else {
      if (to < doc.length) this.view.dispatch({ selection: EditorSelection.cursor(to + 1), scrollIntoView: true });
      else this.view.dispatch({ changes: { from: doc.length, insert: "\n" }, selection: EditorSelection.cursor(doc.length + 1), scrollIntoView: true });
    }
    this.view.focus();
  }

  keydown(event: KeyboardEvent, element: HTMLElement) {
    if (event.isComposing || this.composing) return;
    const { row, col } = this.position(element);
    const rows = this.model.rows.length, cols = this.model.align.length;
    const mod = event.metaKey || event.ctrlKey;
    const caret = caretOffsets(element);
    const stop = () => { event.preventDefault(); event.stopPropagation(); };
    const key = event.key;
    if (mod && !event.altKey && key.toLowerCase() === "z") { stop(); (event.shiftKey ? redo : undo)(this.view); return; }
    if (mod && key.toLowerCase() === "y") { stop(); redo(this.view); return; }
    if (mod && !event.shiftKey && ["b", "i", "u"].includes(key.toLowerCase())) {
      stop();
      const marker = { b: ["**", "**"], i: ["*", "*"], u: ["<u>", "</u>"] }[key.toLowerCase() as "b" | "i" | "u"];
      const selected = window.getSelection()?.toString() ?? "";
      document.execCommand("insertText", false, marker[0] + selected + marker[1]);
      return;
    }
    if (mod && key === "Enter") { stop(); this.insertRow(row + 1); this.focusCell(row + 1, col); return; }
    switch (key) {
      case "Tab":
        stop();
        if (event.shiftKey) {
          if (col > 0) this.focusCell(row, col - 1); else if (row > 0) this.focusCell(row - 1, cols - 1);
        } else if (col < cols - 1) this.focusCell(row, col + 1);
        else if (row < rows - 1) this.focusCell(row + 1, 0);
        else { this.insertRow(rows); this.focusCell(rows, 0); }
        return;
      case "Enter":
        stop();
        if (event.shiftKey) { document.execCommand("insertText", false, "<br>"); return; }
        if (row < rows - 1) this.focusCell(row + 1, col);
        else { this.insertRow(rows); this.focusCell(rows, col); }
        return;
      case "ArrowUp":
        if (row > 0) { stop(); this.focusCell(row - 1, col); } else { stop(); this.exit(-1); }
        return;
      case "ArrowDown":
        if (row < rows - 1) { stop(); this.focusCell(row + 1, col); } else { stop(); this.exit(1); }
        return;
      case "ArrowLeft":
        if (caret && caret.start === 0 && caret.end === 0 && !event.shiftKey) {
          stop();
          if (col > 0) this.focusCell(row, col - 1); else if (row > 0) this.focusCell(row - 1, cols - 1); else this.exit(-1);
        }
        return;
      case "ArrowRight":
        if (caret && caret.start === caret.length && caret.end === caret.length && !event.shiftKey) {
          stop();
          if (col < cols - 1) this.focusCell(row, col + 1, false); else if (row < rows - 1) this.focusCell(row + 1, 0, false); else this.exit(1);
        }
        return;
      case "Escape":
        stop(); this.exit(1);
        return;
    }
  }

  insertRow(at: number) {
    this.model.rows.splice(Math.max(1, at), 0, Array(this.model.align.length).fill(""));
    this.commit("input.table.row");
    this.render();
  }
  deleteRow(at: number) {
    if (at === 0) { this.model.rows[0] = this.model.rows[0].map(() => ""); if (this.model.rows.length > 1) this.model.rows.splice(1, 1)[0].forEach((cell, c) => { this.model.rows[0][c] = cell; }); }
    else this.model.rows.splice(at, 1);
    this.commit("delete.table.row");
    this.render();
  }
  insertColumn(at: number) {
    for (const row of this.model.rows) row.splice(at, 0, "");
    this.model.align.splice(at, 0, null);
    this.commit("input.table.column");
    this.render();
  }
  deleteColumn(at: number) {
    if (this.model.align.length <= 1) { this.deleteTable(); return; }
    for (const row of this.model.rows) row.splice(at, 1);
    this.model.align.splice(at, 1);
    this.commit("delete.table.column");
    this.render();
  }
  moveRow(at: number, by: number) {
    const target = at + by;
    if (at < 1 || target < 1 || target >= this.model.rows.length) return false;
    const [row] = this.model.rows.splice(at, 1);
    this.model.rows.splice(target, 0, row);
    this.commit("move.table.row");
    this.render();
    return true;
  }
  moveColumn(at: number, by: number) {
    const target = at + by;
    if (target < 0 || target >= this.model.align.length) return false;
    for (const row of [...this.model.rows, this.model.align as unknown as string[]]) {
      const [cell] = row.splice(at, 1);
      row.splice(target, 0, cell);
    }
    this.commit("move.table.column");
    this.render();
    return true;
  }
  setAlign(col: number, align: Align) {
    this.model.align[col] = this.model.align[col] === align ? null : align;
    this.commit("input.table.align");
    this.applyAlignment();
  }
  deleteTable() {
    const { from, to } = this.range;
    const doc = this.view.state.doc;
    const end = to < doc.length ? to + 1 : to;
    this.view.dispatch({ changes: { from, to: end }, selection: EditorSelection.cursor(from), userEvent: "delete.table" });
    this.view.focus();
  }

  buildToolbar() {
    this.toolbar.className = "md-table-toolbar";
    this.toolbar.setAttribute("contenteditable", "false");
    const button = (label: string, title: string, run: (row: number, col: number) => void, html?: string) => {
      const element = document.createElement("button");
      element.type = "button";
      element.title = title;
      element.setAttribute("aria-label", title);
      if (html) element.innerHTML = html; else element.textContent = label;
      element.addEventListener("pointerdown", event => event.preventDefault());
      element.addEventListener("mousedown", event => event.preventDefault());
      element.addEventListener("click", event => {
        event.preventDefault();
        const active = this.active ?? { row: 0, col: 0 };
        run(active.row, active.col);
      });
      return element;
    };
    const separator = () => { const s = document.createElement("span"); s.className = "md-table-toolbar-sep"; return s; };
    this.toolbar.append(
      button("", "Align left", (_r, c) => this.setAlign(c, "left"), icons.left),
      button("", "Align center", (_r, c) => this.setAlign(c, "center"), icons.center),
      button("", "Align right", (_r, c) => this.setAlign(c, "right"), icons.right),
      separator(),
      button("↥ Row", "Insert row above", (r, c) => { this.insertRow(Math.max(1, r)); this.focusCell(Math.max(1, r), c); }),
      button("↧ Row", "Insert row below", (r, c) => { this.insertRow(r + 1); this.focusCell(r + 1, c); }),
      button("↤ Col", "Insert column left", (r, c) => { this.insertColumn(c); this.focusCell(r, c); }),
      button("↦ Col", "Insert column right", (r, c) => { this.insertColumn(c + 1); this.focusCell(r, c + 1); }),
      separator(),
      button("⇡", "Move row up", (r, c) => { if (this.moveRow(r, -1)) this.focusCell(r - 1, c); }),
      button("⇣", "Move row down", (r, c) => { if (this.moveRow(r, 1)) this.focusCell(r + 1, c); }),
      button("⇠", "Move column left", (r, c) => { if (this.moveColumn(c, -1)) this.focusCell(r, c - 1); }),
      button("⇢", "Move column right", (r, c) => { if (this.moveColumn(c, 1)) this.focusCell(r, c + 1); }),
      separator(),
      button("− Row", "Delete row", (r, c) => { this.deleteRow(r); this.focusCell(Math.min(r, this.model.rows.length - 1), c); }),
      button("− Col", "Delete column", (r, c) => { this.deleteColumn(c); if (this.dom.isConnected) this.focusCell(r, Math.min(c, this.model.align.length - 1)); }),
      button("🗑", "Delete table", () => this.deleteTable()),
    );
  }
}
