// Assembles the CodeMirror editor: Typora dialect, live preview, Typora
// keymap, source mode, focus/typewriter modes, paste/drop handling.
import { EditorState, Compartment, type Extension, EditorSelection, Prec, StateField } from "@codemirror/state";
import {
  EditorView, keymap, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate, showTooltip, type Tooltip,
  highlightSpecialChars, dropCursor, rectangularSelection, crosshairCursor,
} from "@codemirror/view";
import { history, defaultKeymap, historyKeymap, indentWithTab, undo, redo, moveLineUp, moveLineDown, copyLineDown } from "@codemirror/commands";
import { markdown, markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { syntaxHighlighting, indentUnit, syntaxTree, bracketMatching } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, type CompletionContext } from "@codemirror/autocomplete";
import type { SyntaxNode } from "@lezer/common";
import emojiNames from "markdown-it-emoji/lib/data/full.mjs";
import { Highlight, InlineMath, BlockMath, Footnotes, FrontMatter } from "./syntax";
import { cm5Highlighter } from "../render/highlight";
import { blockDecorations } from "./blocks";
import { inlinePreview, prefixSelectionFilter } from "./inline";
import { editorHost, focusTracking, refreshDecorations, type EditorHost } from "./state";
import * as cmd from "./commands";

export type EditorMode = "live" | "source";

export interface EditorSettings {
  spellcheck: boolean;
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
  tabSize: number;
  focusMode: boolean;
  typewriterMode: boolean;
}

export const defaultEditorSettings: EditorSettings = {
  spellcheck: true, autoPairBrackets: true, autoPairMarkdown: true, tabSize: 4,
  focusMode: false, typewriterMode: false,
};

export interface EditorCallbacks {
  onChange?(view: EditorView, update: ViewUpdate): void;
  onSelection?(view: EditorView): void;
  /** Return true when files (images) from a paste/drop were handled. */
  onFiles?(view: EditorView, files: File[], pos: number | null): boolean;
  /** Typora command shortcuts the app handles (save, sidebar, ...). */
  onShortcut?(name: string): boolean;
}

const emojiList = Object.entries(emojiNames as Record<string, string>);

function emojiCompletion(context: CompletionContext) {
  const word = context.matchBefore(/(^|[\s(])?:[\w+-]{2,}$/);
  if (!word) return null;
  const start = word.text.indexOf(":");
  const query = word.text.slice(start + 1).toLowerCase();
  const options = [];
  for (const [name, emoji] of emojiList) {
    if (!name.startsWith(query) && !(query.length > 2 && name.includes(query))) continue;
    options.push({ label: `:${name}:`, displayLabel: `${emoji}  :${name}:`, type: "text", apply: `:${name}:`, boost: name.startsWith(query) ? 1 : 0 });
    if (options.length > 60) break;
  }
  if (!options.length) return null;
  return { from: word.from + start, options, validFor: /^:[\w+-]*$/ };
}

/** Lines of the top-level block holding the cursor stay bright in focus mode. */
const focusLines = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate) { if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = this.build(update.view); }
  build(view: EditorView) {
    const { state } = view;
    const head = state.selection.main.head;
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(head, -1);
    while (node && node.parent && node.parent.name !== "Document") node = node.parent;
    let from = state.doc.lineAt(head).from, to = state.doc.lineAt(head).to;
    if (node && node.name !== "Document") { from = Math.min(from, node.from); to = Math.max(to, node.to); }
    const first = state.doc.lineAt(from).number, last = state.doc.lineAt(to).number;
    const ranges = [];
    for (let n = first; n <= last; n++) ranges.push(Decoration.line({ class: "md-focus-line" }).range(state.doc.line(n).from));
    return Decoration.set(ranges);
  }
}, { decorations: plugin => plugin.decorations });

const typewriter = EditorState.transactionExtender.of(tr =>
  tr.selection && (tr.docChanged || tr.isUserEvent("select") || tr.isUserEvent("input") || tr.isUserEvent("delete"))
    ? { effects: EditorView.scrollIntoView(tr.selection.main.head, { y: "center" }) } : null);

function linkAt(state: EditorState, pos: number): { href: string; from: number } | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === "Link" || node.name === "Image" || node.name === "Autolink") {
      const url = node.getChild("URL");
      if (!url) return null;
      let href = state.sliceDoc(url.from, url.to);
      if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1);
      return { href, from: node.from };
    }
    if (node.name === "URL" && node.parent?.name !== "LinkReference") {
      const href = state.sliceDoc(node.from, node.to);
      return { href: /^www\./i.test(href) ? "https://" + href : href, from: node.from };
    }
    if (node.name === "Paragraph" || node.name === "Document") break;
  }
  return null;
}

const linkTooltip = StateField.define<readonly Tooltip[]>({
  create: () => [],
  update(tooltips, tr) {
    if (!tr.docChanged && !tr.selection) return tooltips;
    const range = tr.state.selection.main;
    if (!range.empty) return [];
    const link = linkAt(tr.state, range.head);
    if (!link || !link.href) return [];
    return [{
      pos: link.from, above: true, strictSide: false, arrow: false,
      create(view) {
        const dom = document.createElement("div");
        dom.className = "md-link-tooltip";
        const label = document.createElement("span");
        label.className = "md-link-tooltip-url";
        label.textContent = link.href;
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = link.href.startsWith("#") ? "Jump" : "Open";
        open.addEventListener("mousedown", event => event.preventDefault());
        open.addEventListener("click", () => view.state.facet(editorHost).openLink(link.href, view));
        dom.append(label, open);
        return { dom };
      },
    }];
  },
  provide: field => showTooltip.computeN([field], state => state.field(field)),
});

const livePreview: Extension = [
  focusTracking,
  blockDecorations,
  inlinePreview,
  prefixSelectionFilter,
  linkTooltip,
  EditorView.editorAttributes.of({ class: "md-live" }),
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-href]");
      if (target && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        view.state.facet(editorHost).openLink(target.dataset.href!, view);
        return true;
      }
      const footnote = (event.target as HTMLElement).closest(".md-footnote");
      if (footnote && (event.metaKey || event.ctrlKey || event.altKey)) {
        event.preventDefault();
        const label = footnote.getAttribute("title") ?? "";
        const match = new RegExp(`^\\[\\^${(footnote.textContent ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]:`, "m").exec(view.state.doc.toString());
        if (match && label) view.dispatch({ selection: EditorSelection.cursor(match.index + match[0].length), scrollIntoView: true });
        return true;
      }
      return false;
    },
  }),
];

const sourceMode: Extension = [
  EditorView.editorAttributes.of({ class: "md-source" }),
];

export class MarkdownEditor {
  readonly view: EditorView;
  private mode = new Compartment();
  private settingsCompartment = new Compartment();
  private hostCompartment = new Compartment();
  private currentMode: EditorMode = "live";
  settings: EditorSettings;

  constructor(parent: HTMLElement, private host: EditorHost, readonly callbacks: EditorCallbacks, settings: Partial<EditorSettings> = {}) {
    this.settings = { ...defaultEditorSettings, ...settings };
    this.view = new EditorView({ parent, state: this.createState("") });
  }

  private settingsExtensions(): Extension {
    const s = this.settings;
    return [
      EditorView.contentAttributes.of({
        spellcheck: String(s.spellcheck), autocorrect: s.spellcheck ? "on" : "off",
        autocapitalize: "sentences", "aria-label": "Document", id: "write",
      }),
      indentUnit.of(" ".repeat(s.tabSize)),
      EditorState.tabSize.of(s.tabSize),
      s.autoPairBrackets ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
      s.autoPairMarkdown ? cmd.wrapSelectionOnType : [],
      s.focusMode ? [focusLines, EditorView.editorAttributes.of({ class: "md-focus-mode" })] : [],
      s.typewriterMode ? [typewriter, EditorView.editorAttributes.of({ class: "md-typewriter-mode" }), EditorView.scrollMargins.of(view => ({ top: view.dom.clientHeight / 2 - 40, bottom: view.dom.clientHeight / 2 - 40 }))] : [],
    ];
  }

  private keymaps(): Extension {
    const run = (name: string) => () => this.callbacks.onShortcut?.(name) ?? false;
    const v = (fn: (view: EditorView) => boolean) => (view: EditorView) => fn(view);
    return [
      Prec.high(keymap.of([
        // File / app level (handled by the app shell).
        { key: "Mod-s", run: run("save"), preventDefault: true },
        { key: "Mod-Shift-s", run: run("saveAs"), preventDefault: true },
        { key: "Mod-o", run: run("open"), preventDefault: true },
        { key: "Mod-n", run: run("new"), preventDefault: true },
        { key: "Mod-p", run: run("quickOpen"), preventDefault: true },
        { key: "Mod-Shift-o", run: run("quickOpen"), preventDefault: true },
        { key: "Mod-Shift-p", run: run("commandPalette"), preventDefault: true },
        { key: "Mod-Shift-l", run: run("toggleSidebar"), preventDefault: true },
        { key: "Mod-Shift-1", run: run("outline"), preventDefault: true },
        { key: "Mod-Shift-2", run: run("articles"), preventDefault: true },
        { key: "Mod-Shift-3", run: run("fileTree"), preventDefault: true },
        { key: "Mod-Shift-f", run: run("searchFiles"), preventDefault: true },
        { key: "Mod-/", run: run("toggleSource"), preventDefault: true },
        { key: "F8", run: run("focusMode"), preventDefault: true },
        { key: "F9", run: run("typewriterMode"), preventDefault: true },
        { key: "F11", run: run("fullscreen"), preventDefault: true },
        { key: "Mod-,", run: run("preferences"), preventDefault: true },
        { key: "Mod-Alt-t", run: run("insertTable"), preventDefault: true },
        { key: "Mod-t", run: run("insertTable"), preventDefault: true },
        { key: "Mod-Shift-i", run: run("insertImage"), preventDefault: true },
        { key: "Mod-Shift-c", run: run("copyMarkdown"), preventDefault: true },
        { key: "Mod-Shift-v", run: run("pastePlain"), preventDefault: true },
        // Paragraph menu.
        ...[1, 2, 3, 4, 5, 6].map(level => ({ key: `Mod-${level}`, run: v(cmd.setHeading(level)), preventDefault: true })),
        { key: "Mod-0", run: v(cmd.setHeading(0)), preventDefault: true },
        { key: "Mod-=", run: v(cmd.shiftHeading(-1)), preventDefault: true },
        { key: "Mod--", run: v(cmd.shiftHeading(1)), preventDefault: true },
        { key: "Mod-Alt-c", run: v(cmd.insertCodeFence), preventDefault: true },
        { key: "Mod-Shift-k", run: v(cmd.insertCodeFence), preventDefault: true },
        { key: "Mod-Alt-b", run: v(cmd.insertMathBlock), preventDefault: true },
        { key: "Mod-Shift-m", run: v(cmd.insertMathBlock), preventDefault: true },
        { key: "Mod-Alt-q", run: v(cmd.toggleQuote), preventDefault: true },
        { key: "Mod-Shift-q", run: v(cmd.toggleQuote), preventDefault: true },
        { key: "Mod-Alt-o", run: v(cmd.toggleList("ordered")), preventDefault: true },
        { key: "Mod-Shift-[", run: v(cmd.toggleList("ordered")), preventDefault: true },
        { key: "Mod-Alt-u", run: v(cmd.toggleList("bullet")), preventDefault: true },
        { key: "Mod-Shift-]", run: v(cmd.toggleList("bullet")), preventDefault: true },
        { key: "Mod-Alt-x", run: v(cmd.toggleList("task")), preventDefault: true },
        { key: "Mod-Shift-x", run: v(cmd.toggleTask), preventDefault: true },
        { key: "Mod-]", run: v(cmd.indentList(1)), preventDefault: true },
        { key: "Mod-[", run: v(cmd.indentList(-1)), preventDefault: true },
        { key: "Mod-Alt--", run: v(cmd.insertHorizontalRule), preventDefault: true },
        // Format menu.
        { key: "Mod-b", run: v(cmd.toggleFormat("strong")), preventDefault: true },
        { key: "Mod-i", run: v(cmd.toggleFormat("emphasis")), preventDefault: true },
        { key: "Mod-u", run: v(cmd.toggleFormat("underline")), preventDefault: true },
        { key: "Mod-Shift-`", run: v(cmd.toggleFormat("code")), preventDefault: true },
        { key: "Ctrl-`", run: v(cmd.toggleFormat("code")), preventDefault: true },
        { key: "Alt-Shift-5", run: v(cmd.toggleFormat("strike")), preventDefault: true },
        { key: "Mod-Shift-5", run: v(cmd.toggleFormat("strike")), preventDefault: true },
        { key: "Mod-Shift-h", run: v(cmd.toggleFormat("highlight")), preventDefault: true },
        { key: "Mod-k", run: v(cmd.insertLink), preventDefault: true },
        { key: "Mod-\\", run: v(cmd.clearFormat), preventDefault: true },
        // Edit menu.
        { key: "Mod-l", run: v(cmd.selectLine), preventDefault: true },
        { key: "Mod-d", run: v(cmd.selectWord), preventDefault: true },
        { key: "Mod-e", run: v(cmd.selectScope), preventDefault: true },
        { key: "Mod-Shift-d", run: v(cmd.deleteWord), preventDefault: true },
        { key: "Mod-h", run: v(openSearchPanel), preventDefault: true },
        { key: "Alt-ArrowUp", run: moveLineUp },
        { key: "Alt-ArrowDown", run: moveLineDown },
        { key: "Shift-Alt-ArrowDown", run: copyLineDown },
        { key: "Mod-y", run: redo, preventDefault: true },
      ])),
    ];
  }

  private modeExtensions(mode: EditorMode): Extension {
    if (mode === "source") return [sourceMode, keymap.of(markdownKeymap)];
    return [
      livePreview,
      Prec.highest(keymap.of([
        { key: "Enter", run: cmd.typoraEnter },
        { key: "Shift-Enter", run: cmd.softBreak },
        { key: "Backspace", run: cmd.typoraBackspace },
        { key: "Backspace", run: cmd.deleteMarkupBackward },
        { key: "Delete", run: cmd.typoraDelete },
        { key: "Tab", run: cmd.indentList(1) },
        { key: "Shift-Tab", run: cmd.indentList(-1) },
        { key: "ArrowDown", run: cmd.arrowPastEdge(1) },
        { key: "ArrowUp", run: cmd.arrowPastEdge(-1) },
      ])),
    ];
  }

  createState(text: string, selection?: EditorSelection | { anchor: number; head?: number }): EditorState {
    return EditorState.create({
      doc: text,
      selection,
      extensions: [
        this.hostCompartment.of(editorHost.of(this.host)),
        markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [Highlight, InlineMath, BlockMath, Footnotes, FrontMatter], completeHTMLTags: false, addKeymap: false }),
        history(),
        highlightSpecialChars(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        bracketMatching(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        syntaxHighlighting(cm5Highlighter),
        search({ top: true }),
        autocompletion({ override: [emojiCompletion], icons: false, activateOnTyping: true }),
        this.keymaps(),
        this.mode.of(this.modeExtensions(this.currentMode)),
        this.settingsCompartment.of(this.settingsExtensions()),
        keymap.of([...completionKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
        EditorView.updateListener.of(update => {
          if (update.docChanged) this.callbacks.onChange?.(update.view, update);
          if (update.selectionSet || update.docChanged) this.callbacks.onSelection?.(update.view);
        }),
        EditorView.domEventHandlers({
          paste: (event, view) => this.handlePaste(event, view),
          drop: (event, view) => {
            const files = [...(event.dataTransfer?.files ?? [])];
            if (!files.length) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (this.callbacks.onFiles?.(view, files, pos)) { event.preventDefault(); return true; }
            return false;
          },
          copy: (event, view) => this.handleCopy(event, view),
          cut: (event, view) => this.handleCopy(event, view),
        }),
      ],
    });
  }

  private handleCopy(event: ClipboardEvent, view: EditorView) {
    if (this.currentMode !== "live" || !event.clipboardData) return false;
    const range = view.state.selection.main;
    if (range.empty) return false;
    const text = view.state.sliceDoc(range.from, range.to);
    // Plain text carries the Markdown; HTML lets rich editors paste formatted text.
    event.clipboardData.setData("text/plain", text);
    try {
      const html = renderForClipboard?.(text);
      if (html) event.clipboardData.setData("text/html", `<meta name="typorium" content="1">${html}`);
    } catch { /* plain text is enough */ }
    event.preventDefault();
    if (event.type === "cut") view.dispatch({ changes: { from: range.from, to: range.to }, userEvent: "delete.cut" });
    return true;
  }

  private handlePaste(event: ClipboardEvent, view: EditorView) {
    const data = event.clipboardData;
    if (!data) return false;
    const files = [...data.files].filter(file => file.type.startsWith("image/"));
    if (files.length && this.callbacks.onFiles?.(view, files, null)) { event.preventDefault(); return true; }
    if (this.currentMode !== "live") return false;
    const head = view.state.selection.main.head;
    if (cmd.inCode(view.state, head)) return false;
    const html = data.getData("text/html");
    const plain = data.getData("text/plain");
    if (html && !html.includes('name="typorium"') && htmlToMarkdownHook) {
      const markdown = htmlToMarkdownHook(html);
      if (markdown && markdown.trim() && markdown.trim() !== plain.trim()) {
        event.preventDefault();
        view.dispatch(view.state.replaceSelection(markdown), { userEvent: "input.paste", scrollIntoView: true });
        return true;
      }
    }
    return false;
  }

  get modeName(): EditorMode { return this.currentMode; }

  setMode(mode: EditorMode) {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    const head = this.view.state.selection.main.head;
    this.view.dispatch({ effects: [this.mode.reconfigure(this.modeExtensions(mode)), EditorView.scrollIntoView(head, { y: "center" })] });
  }

  updateSettings(settings: Partial<EditorSettings>) {
    this.settings = { ...this.settings, ...settings };
    this.view.dispatch({ effects: this.settingsCompartment.reconfigure(this.settingsExtensions()) });
  }

  setHost(host: EditorHost) {
    this.host = host;
    this.view.dispatch({ effects: [this.hostCompartment.reconfigure(editorHost.of(host)), refreshDecorations.of(null)] });
  }

  /** Swap in another document's state (each document keeps its own undo history). */
  setState(state: EditorState) {
    this.view.setState(state);
    // The compartments in a stored state may be stale; refresh them.
    this.view.dispatch({ effects: [
      this.mode.reconfigure(this.modeExtensions(this.currentMode)),
      this.settingsCompartment.reconfigure(this.settingsExtensions()),
      this.hostCompartment.reconfigure(editorHost.of(this.host)),
    ] });
  }

  refresh() { this.view.dispatch({ effects: refreshDecorations.of(null) }); }
  focus() { this.view.focus(); }
  undo() { return undo(this.view); }
  redo() { return redo(this.view); }
  get text() { return this.view.state.doc.toString(); }
}

let renderForClipboard: ((markdown: string) => string) | null = null;
let htmlToMarkdownHook: ((html: string) => string) | null = null;
export function setClipboardConverters(toHtml: (markdown: string) => string, toMarkdown: (html: string) => string) {
  renderForClipboard = toHtml;
  htmlToMarkdownHook = toMarkdown;
}
