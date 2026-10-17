// The Typorium application shell: layout, commands, menus, documents, files,
// themes, export, and the glue between them and the editor.
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo, redo, selectAll, moveLineUp, moveLineDown } from "@codemirror/commands";
import { openSearchPanel, findNext, findPrevious } from "@codemirror/search";
import { startCompletion } from "@codemirror/autocomplete";
import { MarkdownEditor, setClipboardConverters, type EditorMode } from "../editor/editor";
import * as cmd from "../editor/commands";
import { collectHeadings } from "../editor/blocks";
import { h, icon, icons } from "./dom";
import { isApple, isIOS, isTouch, isStandalone, shortcutLabel } from "./platform";
import { loadPreferences, savePreferences, type Preferences } from "./prefs";
import { Documents, type Doc, type DocLocation, decodeText, docDirectory } from "./documents";
import { builtinThemes, customThemes, applyTheme, importTheme, deleteCustomTheme, exportCss, type Theme } from "./themes";
import { menuBar, type MenuEntry } from "./menus";
import { toast, modal, confirmDialog, choiceDialog, promptDialog, showMenu, closeMenus, pickFiles, saveBlob, type MenuItem } from "./ui";
import { Sidebar } from "./sidebar";
import { FormatBar } from "./formatbar";
import { openPreferences } from "./preferencesDialog";
import { quickOpen, commandPalette } from "./palette";
import { exportHtml, printDocument, htmlToMarkdown, markdownToClipboardHtml } from "./exporter";
import { documentStats } from "./stats";
import { welcomeDocument, markdownReference } from "./samples";
import { type Workspace, libraryWorkspace, FolderWorkspace, folderAccessSupported, fileAccessSupported, rememberFolder, savedFolders, forgetFolder, ensurePermission } from "../storage/workspace";
import { kv } from "../storage/idb";
import { join, dirname, basename, normalize, isMarkdown, extname, stem, encodePath, relative } from "../storage/paths";

export interface Command {
  id: string;
  label: string;
  key?: string;
  run: () => unknown;
  checked?: () => boolean;
  enabled?: () => boolean;
}

interface Recent { kind: "file" | "folder"; workspaceId: string; path: string; name: string; time: number }

type OpenFilePicker = (options?: { multiple?: boolean; types?: { description: string; accept: Record<string, string[]> }[]; excludeAcceptAllOption?: boolean }) => Promise<FileSystemFileHandle[]>;
type SaveFilePicker = (options?: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;
type DirectoryPicker = (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>;

const markdownTypes = [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown", ".mdown", ".mkd", ".txt"] } }];

export class App {
  prefs: Preferences = loadPreferences();
  docs = new Documents();
  editor!: MarkdownEditor;
  sidebar!: Sidebar;
  formatBar!: FormatBar;
  commands = new Map<string, Command>();
  workspace: Workspace = libraryWorkspace;
  themes: Theme[] = [...builtinThemes];
  root!: HTMLElement;
  titleElement!: HTMLElement;
  statusWords!: HTMLButtonElement;
  statusMode!: HTMLButtonElement;
  menubar!: HTMLElement;
  private switching = false;
  /** The document whose state the editor view currently shows. */
  private shownId: string | null = null;
  private autosaveTimer = 0;
  private statsTimer = 0;
  private outlineTimer = 0;
  private imageUrls = new Map<string, string>();
  private installPrompt: (Event & { prompt(): Promise<void> }) | null = null;
  private zoom = 1;
  private systemDark = matchMedia("(prefers-color-scheme: dark)");

  async start(container: HTMLElement) {
    this.buildLayout(container);
    this.registerCommands();
    this.renderMenubar();
    setClipboardConverters(markdownToClipboardHtml, htmlToMarkdown);
    await this.loadThemes();
    this.applyPreferences();
    this.systemDark.addEventListener("change", () => this.applyThemePreference());
    this.bindGlobalEvents();
    await this.restoreSession();
    this.setupPwa();
    void navigator.storage?.persist?.();
  }

  /* ================= Layout ================= */

  buildLayout(container: HTMLElement) {
    const sidebarToggle = h("button", { type: "button", class: "icon-button", title: `Toggle sidebar (${shortcutLabel("Mod-Shift-l")})`, "aria-label": "Toggle sidebar", onclick: () => this.run("view.sidebar") }, icon(icons.sidebar));
    this.menubar = h("nav", { class: "menubar", "aria-label": "Menu" });
    const compactMenu = h("button", { type: "button", class: "icon-button compact-menu", title: "Menu", "aria-label": "Menu", onclick: (event: MouseEvent) => this.openCompactMenu(event.currentTarget as HTMLElement) }, icon(icons.menu));
    this.titleElement = h("div", { class: "doc-title", title: "" });
    const sourceToggle = h("button", { type: "button", class: "icon-button", title: `Source code mode (${shortcutLabel("Mod-/")})`, "aria-label": "Toggle source code mode", onclick: () => this.run("view.source") }, icon(icons.source));
    const more = h("button", { type: "button", class: "icon-button", title: "More", "aria-label": "More actions", onclick: (event: MouseEvent) => this.openCompactMenu(event.currentTarget as HTMLElement, true) }, icon(icons.more));
    const titlebar = h("header", { class: "titlebar" }, sidebarToggle, compactMenu, this.menubar, this.titleElement, h("div", { class: "titlebar-actions" }, sourceToggle, more));

    const editorHost = h("div", { class: "editor-host" });
    const pane = h("main", { class: "editor-pane" }, editorHost);
    this.sidebar = new Sidebar(this);
    const scrim = h("div", { class: "sidebar-scrim", onclick: () => this.setSidebar(false) });

    this.statusMode = h("button", { type: "button", class: "status-button", title: `Toggle source code mode (${shortcutLabel("Mod-/")})`, onclick: () => this.run("view.source") }, icon(icons.source, 14));
    this.statusWords = h("button", { type: "button", class: "status-button status-words", onclick: () => this.showStats() }, "");
    const statusbar = h("footer", { class: "statusbar" },
      h("button", { type: "button", class: "status-button", title: "Toggle sidebar", "aria-label": "Toggle sidebar", onclick: () => this.run("view.sidebar") }, icon(icons.sidebar, 14)),
      this.statusMode,
      h("span", { class: "status-message" }),
      this.statusWords);

    const body = h("div", { class: "app-body" }, this.sidebar.element, scrim, pane);
    this.root = h("div", { id: "typorium", class: "app" }, titlebar, body, statusbar);
    container.append(this.root);

    this.editor = new MarkdownEditor(editorHost, {
      resolveImage: src => this.resolveImage(src),
      openLink: href => this.openLink(href),
    }, {
      onChange: () => this.onDocChanged(),
      onSelection: () => this.onSelectionChanged(),
      onFiles: (view, files, pos) => this.insertFiles(view, files, pos),
      onShortcut: name => this.shortcut(name),
    }, this.editorSettings());
    this.formatBar = new FormatBar(this);
    statusbar.before(this.formatBar.element);
  }

  editorSettings() {
    const p = this.prefs;
    return { spellcheck: p.spellcheck, autoPairBrackets: p.autoPairBrackets, autoPairMarkdown: p.autoPairMarkdown, tabSize: p.tabSize, focusMode: p.focusMode, typewriterMode: p.typewriterMode };
  }

  get view(): EditorView { return this.editor.view; }
  get doc(): Doc | null { return this.docs.active; }

  /* ================= Commands ================= */

  add(id: string, label: string, run: () => unknown, extra: Partial<Command> = {}) {
    this.commands.set(id, { id, label, run, ...extra });
  }

  run(id: string) {
    const command = this.commands.get(id);
    if (!command || (command.enabled && !command.enabled())) return false;
    closeMenus();
    try {
      const result = command.run();
      if (result instanceof Promise) result.catch(error => this.error(error));
    } catch (error) { this.error(error); }
    return true;
  }

  error(error: unknown) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    if (/abort/i.test(message) && (error as DOMException)?.name === "AbortError") return;
    toast(message, { kind: "error", timeout: 5000 });
  }

  edit(fn: (view: EditorView) => boolean) {
    return () => { if (this.editor.modeName === "source" && fn === cmd.typoraEnter) return; fn(this.view); this.view.focus(); };
  }

  registerCommands() {
    const e = (fn: (view: EditorView) => boolean) => this.edit(fn);
    const live = () => true;
    // File
    this.add("file.new", "New", () => this.newDocument(), { key: "Mod-n" });
    this.add("file.open", "Open…", () => this.openFile(), { key: "Mod-o" });
    this.add("file.openFolder", folderAccessSupported ? "Open Folder…" : "Open Folder… (not supported in this browser)", () => this.openFolder(), { enabled: () => folderAccessSupported });
    this.add("file.quickOpen", "Quick Open…", () => quickOpen(this), { key: isApple ? "Mod-Shift-o" : "Mod-p" });
    this.add("file.save", "Save", () => this.save(), { key: "Mod-s" });
    this.add("file.saveAs", "Save As…", () => this.saveAs(), { key: "Mod-Shift-s" });
    this.add("file.rename", "Rename…", () => this.renameCurrent(), { enabled: () => this.doc?.location.kind === "workspace" });
    this.add("file.moveTo", "Move To…", () => this.moveCurrent(), { enabled: () => this.doc?.location.kind === "workspace" });
    this.add("file.revealInSidebar", "Reveal in Sidebar", () => this.revealCurrent(), { enabled: () => this.doc?.location.kind === "workspace" });
    this.add("file.delete", "Delete…", () => this.deleteCurrent(), { enabled: () => this.doc?.location.kind === "workspace" });
    this.add("file.import", "Import…", () => this.importFiles());
    this.add("file.print", "Print…", () => this.print(), { key: "Mod-Alt-p" });
    this.add("file.properties", "Document Properties…", () => this.showStats());
    this.add("file.close", "Close Document", () => this.closeDocument(), { key: "Mod-Alt-w", enabled: () => !!this.doc });
    // Export
    this.add("export.pdf", "PDF (via Print)", () => this.print());
    this.add("export.html", "HTML", () => this.exportHtml(true));
    this.add("export.htmlPlain", "HTML (without styles)", () => this.exportHtml(false));
    this.add("export.markdown", "Markdown file", () => this.exportMarkdown());
    this.add("export.copyHtml", "Copy as HTML Code", () => this.copyHtml());
    // Edit
    this.add("edit.undo", "Undo", e(undo), { key: "Mod-z" });
    this.add("edit.redo", "Redo", e(redo), { key: isApple ? "Mod-Shift-z" : "Mod-y" });
    this.add("edit.cut", "Cut", () => { this.view.focus(); document.execCommand("cut"); }, { key: "Mod-x" });
    this.add("edit.copy", "Copy", () => { this.view.focus(); document.execCommand("copy"); }, { key: "Mod-c" });
    this.add("edit.paste", "Paste", () => this.paste(false), { key: "Mod-v" });
    this.add("edit.copyMarkdown", "Copy as Markdown", () => this.copyMarkdown(), { key: "Mod-Shift-c" });
    this.add("edit.copyHtml", "Copy as HTML Code", () => this.copyHtml());
    this.add("edit.pastePlain", "Paste as Plain Text", () => this.paste(true), { key: "Mod-Shift-v" });
    this.add("edit.selectAll", "Select All", e(selectAll), { key: "Mod-a" });
    this.add("edit.selectScope", "Select Styled Scope", e(cmd.selectScope), { key: "Mod-e" });
    this.add("edit.selectLine", "Select Line / Sentence", e(cmd.selectLine), { key: "Mod-l" });
    this.add("edit.selectWord", "Select Word", e(cmd.selectWord), { key: "Mod-d" });
    this.add("edit.deleteWord", "Delete Word", e(cmd.deleteWord), { key: "Mod-Shift-d" });
    this.add("edit.moveLineUp", "Move Line Up", e(moveLineUp), { key: "Alt-ArrowUp" });
    this.add("edit.moveLineDown", "Move Line Down", e(moveLineDown), { key: "Alt-ArrowDown" });
    this.add("edit.find", "Find…", e(openSearchPanel), { key: "Mod-f" });
    this.add("edit.replace", "Replace…", e(openSearchPanel), { key: "Mod-h" });
    this.add("edit.findNext", "Find Next", e(findNext), { key: "Mod-g" });
    this.add("edit.findPrevious", "Find Previous", e(findPrevious), { key: "Mod-Shift-g" });
    this.add("edit.searchFiles", "Search in Files…", () => { this.setSidebar(true); this.sidebar.setTab("search"); this.sidebar.focusSearch(); }, { key: "Mod-Shift-f" });
    this.add("edit.emoji", "Insert Emoji…", () => this.insertEmoji());
    // Paragraph
    for (let level = 1; level <= 6; level++) this.add(`para.h${level}`, `Heading ${level}`, e(cmd.setHeading(level)), { key: `Mod-${level}`, checked: () => this.blockKind() === `h${level}` });
    this.add("para.paragraph", "Paragraph", e(cmd.setHeading(0)), { key: "Mod-0", checked: () => this.blockKind() === "p" });
    this.add("para.headingUp", "Increase Heading Level", e(cmd.shiftHeading(-1)), { key: "Mod-=" });
    this.add("para.headingDown", "Decrease Heading Level", e(cmd.shiftHeading(1)), { key: "Mod--" });
    this.add("para.table", "Table…", () => this.insertTableDialog(), { key: "Mod-t" });
    this.add("para.code", "Code Fences", e(cmd.insertCodeFence), { key: "Mod-Shift-k" });
    this.add("para.math", "Math Block", e(cmd.insertMathBlock), { key: "Mod-Shift-m" });
    this.add("para.quote", "Quote", e(cmd.toggleQuote), { key: "Mod-Shift-q", checked: () => this.blockKind() === "quote" });
    this.add("para.orderedList", "Ordered List", e(cmd.toggleList("ordered")), { key: "Mod-Shift-[", checked: () => this.blockKind() === "ol" });
    this.add("para.bulletList", "Unordered List", e(cmd.toggleList("bullet")), { key: "Mod-Shift-]", checked: () => this.blockKind() === "ul" });
    this.add("para.taskList", "Task List", e(cmd.toggleList("task")), { key: "Mod-Alt-x", checked: () => this.blockKind() === "task" });
    this.add("para.toggleTask", "Toggle Task Status", e(cmd.toggleTask), { key: "Mod-Shift-x" });
    this.add("para.taskDone", "Mark as Complete", e(cmd.setTaskStatus(true)));
    this.add("para.taskUndone", "Mark as Incomplete", e(cmd.setTaskStatus(false)));
    this.add("para.indent", "Indent", e(cmd.indentList(1)), { key: "Mod-]" });
    this.add("para.outdent", "Outdent", e(cmd.indentList(-1)), { key: "Mod-[" });
    this.add("para.insertBefore", "Insert Paragraph Before", e(cmd.insertParagraph("before")));
    this.add("para.insertAfter", "Insert Paragraph After", e(cmd.insertParagraph("after")));
    this.add("para.linkReference", "Link Reference", e(cmd.insertLinkReference));
    this.add("para.footnote", "Footnotes", e(cmd.insertFootnote), { key: "Mod-Alt-r" });
    this.add("para.hr", "Horizontal Line", e(cmd.insertHorizontalRule), { key: "Mod-Alt--" });
    this.add("para.toc", "Table of Contents", e(cmd.insertToc));
    this.add("para.yaml", "YAML Front Matter", e(cmd.insertFrontMatter));
    // Format
    this.add("fmt.strong", "Strong", e(cmd.toggleFormat("strong")), { key: "Mod-b" });
    this.add("fmt.emphasis", "Emphasis", e(cmd.toggleFormat("emphasis")), { key: "Mod-i" });
    this.add("fmt.underline", "Underline", e(cmd.toggleFormat("underline")), { key: "Mod-u" });
    this.add("fmt.code", "Code", e(cmd.toggleFormat("code")), { key: "Mod-Shift-`" });
    this.add("fmt.strike", "Strike", e(cmd.toggleFormat("strike")), { key: isApple ? "Ctrl-Shift-`" : "Alt-Shift-5" });
    this.add("fmt.highlight", "Highlight", e(cmd.toggleFormat("highlight")), { key: "Mod-Shift-h" });
    this.add("fmt.superscript", "Superscript", e(cmd.toggleFormat("superscript")));
    this.add("fmt.subscript", "Subscript", e(cmd.toggleFormat("subscript")));
    this.add("fmt.comment", "Comment", e(cmd.toggleFormat("comment")), { key: "Mod-Shift-/" });
    this.add("fmt.inlineMath", "Inline Math", e(cmd.toggleFormat("inlineMath")));
    this.add("fmt.kbd", "Keyboard Key", e(cmd.toggleFormat("kbd")));
    this.add("fmt.link", "Hyperlink", e(cmd.insertLink), { key: "Mod-k" });
    this.add("fmt.image", "Image…", () => this.insertImageDialog(), { key: "Mod-Shift-i" });
    this.add("fmt.clear", "Clear Format", e(cmd.clearFormat), { key: "Mod-\\" });
    // View
    this.add("view.source", "Source Code Mode", () => this.toggleSource(), { key: "Mod-/", checked: () => this.editor.modeName === "source" });
    this.add("view.sidebar", "Sidebar", () => this.setSidebar(!this.sidebarOpen()), { key: "Mod-Shift-l", checked: () => this.sidebarOpen() });
    this.add("view.outline", "Outline", () => this.showSidebarTab("outline"), { key: "Mod-Shift-1", checked: () => this.sidebarOpen() && this.prefs.sidebarTab === "outline" });
    this.add("view.files", "Files", () => this.showSidebarTab("files"), { key: "Mod-Shift-2", checked: () => this.sidebarOpen() && this.prefs.sidebarTab === "files" });
    this.add("view.search", "Search", () => this.showSidebarTab("search"), { key: "Mod-Shift-3", checked: () => this.sidebarOpen() && this.prefs.sidebarTab === "search" });
    this.add("view.focus", "Focus Mode", () => this.togglePref("focusMode"), { key: "F8", checked: () => this.prefs.focusMode });
    this.add("view.typewriter", "Typewriter Mode", () => this.togglePref("typewriterMode"), { key: "F9", checked: () => this.prefs.typewriterMode });
    this.add("view.statusBar", "Status Bar", () => this.togglePref("showStatusBar"), { checked: () => this.prefs.showStatusBar });
    this.add("view.formatBar", "Formatting Toolbar", () => { this.prefs.showFormatBar = this.formatBar.visible ? "never" : "always"; this.savePrefs(); this.formatBar.update(); }, { checked: () => this.formatBar.visible });
    this.add("view.zoomIn", "Zoom In", () => this.setZoom(this.zoom + 0.1), { key: "Mod-Shift-=" });
    this.add("view.zoomOut", "Zoom Out", () => this.setZoom(this.zoom - 0.1), { key: "Mod-Shift--" });
    this.add("view.zoomReset", "Actual Size", () => this.setZoom(1), { key: "Mod-Shift-0" });
    this.add("view.fullscreen", "Toggle Full Screen", () => this.toggleFullscreen(), { key: "F11", enabled: () => !!document.documentElement.requestFullscreen });
    this.add("view.commandPalette", "Command Palette…", () => commandPalette(this), { key: "Mod-Shift-p" });
    // Themes
    this.add("theme.list", "Themes", () => {});
    this.add("theme.import", "Import Typora Theme…", () => this.importThemeDialog());
    this.add("theme.manage", "Remove Imported Theme…", () => this.manageThemes(), { enabled: () => this.themes.some(theme => !theme.builtin) });
    this.add("theme.appearanceAuto", "Follow System Dark Mode", () => this.setAppearance("auto"), { checked: () => this.prefs.appearance === "auto" });
    this.add("theme.appearanceLight", "Always Use Selected Theme", () => this.setAppearance("light"), { checked: () => this.prefs.appearance === "light" });
    this.add("theme.appearanceDark", "Always Dark", () => this.setAppearance("dark"), { checked: () => this.prefs.appearance === "dark" });
    // App / help
    this.add("app.preferences", "Preferences…", () => openPreferences(this), { key: "Mod-," });
    this.add("app.install", "Install Typorium as an App…", () => this.install());
    this.add("help.welcome", "Welcome Guide", () => this.openGuide("Welcome to Typorium.md", welcomeDocument));
    this.add("help.markdownReference", "Markdown Reference", () => this.openGuide("Markdown Reference.md", markdownReference));
    this.add("help.shortcuts", "Keyboard Shortcuts", () => this.showShortcuts());
    this.add("help.storage", "Where Are My Files?", () => this.showStorageInfo());
    this.add("help.about", "About Typorium", () => this.about());
    this.add("file.recent", "Recent", () => {});
    void live;
  }

  /** Current block type at the cursor, for menu check marks. */
  blockKind() {
    const state = this.view.state;
    const line = state.doc.lineAt(state.selection.main.head).text;
    const heading = /^(?:\s*>\s?)*\s*(#{1,6})\s/.exec(line);
    if (heading) return `h${heading[1].length}`;
    if (/^\s*(?:>\s?)*\s*[-*+]\s+\[[ xX]\]/.test(line)) return "task";
    if (/^\s*(?:>\s?)*\s*[-*+]\s/.test(line)) return "ul";
    if (/^\s*(?:>\s?)*\s*\d+[.)]\s/.test(line)) return "ol";
    if (/^\s*>/.test(line)) return "quote";
    return "p";
  }

  shortcut(name: string): boolean {
    const map: Record<string, string> = {
      save: "file.save", saveAs: "file.saveAs", open: "file.open", new: "file.new", quickOpen: "file.quickOpen",
      commandPalette: "view.commandPalette", toggleSidebar: "view.sidebar", outline: "view.outline", articles: "view.files",
      fileTree: "view.files", searchFiles: "edit.searchFiles", toggleSource: "view.source", focusMode: "view.focus",
      typewriterMode: "view.typewriter", fullscreen: "view.fullscreen", preferences: "app.preferences",
      insertTable: "para.table", insertImage: "fmt.image", copyMarkdown: "edit.copyMarkdown", pastePlain: "edit.pastePlain",
    };
    return map[name] ? this.run(map[name]) : false;
  }

  /* ================= Menus ================= */

  menuItems(entries: MenuEntry[]): MenuItem[] {
    const items: MenuItem[] = [];
    for (const entry of entries) {
      if (entry === "-") { items.push({ separator: true }); continue; }
      if (typeof entry === "object") {
        const sub = typeof entry.items === "function" ? entry.items() : entry.items;
        items.push({ label: entry.label, submenu: () => this.menuItems(sub) });
        continue;
      }
      if (entry === "theme.list") { items.push(...this.themeItems()); continue; }
      if (entry === "file.recent") { items.push(...this.recentItems()); continue; }
      const command = this.commands.get(entry);
      if (!command) continue;
      items.push({
        label: command.label, shortcut: command.key, run: () => this.run(command.id),
        checked: command.checked ? command.checked() : undefined,
        disabled: command.enabled ? !command.enabled() : false,
      });
    }
    return items;
  }

  themeItems(): MenuItem[] {
    return this.themes.map(theme => ({ label: theme.name, checked: this.prefs.theme === theme.id, run: () => this.setTheme(theme.id) }));
  }

  recentList: Recent[] = [];

  recentItems(): MenuItem[] {
    if (!this.recentList.length) return [{ label: "No Recent Files", disabled: true }];
    return [
      ...this.recentList.slice(0, 12).map(item => ({
        label: item.kind === "folder" ? `📁 ${item.name}` : item.name,
        run: () => item.kind === "folder" ? this.switchWorkspace(item.workspaceId) : this.openRecent(item),
      })),
      { separator: true },
      { label: "Clear Recent Files", run: () => { this.recentList = []; void kv.set("recent", []); } },
    ];
  }

  renderMenubar() {
    this.menubar.replaceChildren();
    for (const menu of menuBar) {
      const button = h("button", { type: "button", class: "menubar-item", "aria-haspopup": "menu" }, menu.label);
      const open = () => {
        if (button.classList.contains("open")) return;
        this.menubar.querySelectorAll(".open").forEach(el => el.classList.remove("open"));
        button.classList.add("open");
        const entries = typeof menu.items === "function" ? menu.items() : menu.items;
        showMenu(this.menuItems(entries), button, { className: "menubar-menu", onClose: () => button.classList.remove("open") });
      };
      button.addEventListener("mousedown", event => { event.preventDefault(); if (button.classList.contains("open")) closeMenus(); else open(); });
      button.addEventListener("click", event => { if ((event as PointerEvent).pointerType !== "mouse" && event.detail === 0) open(); });
      button.addEventListener("pointerenter", () => { if (this.menubar.querySelector(".open") && !button.classList.contains("open")) { closeMenus(); open(); } });
      this.menubar.append(button);
    }
  }

  openCompactMenu(anchor: HTMLElement, alignRight = false) {
    const items: MenuItem[] = menuBar.map(menu => ({ label: menu.label, submenu: () => this.menuItems(typeof menu.items === "function" ? menu.items() : menu.items) }));
    showMenu(items, anchor, { align: alignRight ? "right" : "left", className: "compact-menu-popup" });
  }

  /* ================= Preferences, themes, view ================= */

  savePrefs() { savePreferences(this.prefs); }

  applyPreferences() {
    const p = this.prefs;
    const style = document.documentElement.style;
    style.setProperty("--write-font-size", `${p.fontSize}px`);
    style.setProperty("--write-line-height", String(p.lineHeight));
    style.setProperty("--write-max-width", { narrow: "720px", normal: "860px", wide: "1100px", full: "100%" }[p.lineWidth]);
    this.root.classList.toggle("hide-statusbar", !p.showStatusBar);
    this.editor.updateSettings(this.editorSettings());
    this.setSidebar(p.sidebarVisible && window.innerWidth > 760, false);
    this.sidebar.setTab(p.sidebarTab);
    this.applyThemePreference();
    this.formatBar?.update();
  }

  async loadThemes() {
    this.themes = [...builtinThemes, ...(await customThemes())];
  }

  currentTheme(): Theme {
    const selected = this.themes.find(theme => theme.id === this.prefs.theme) ?? builtinThemes[0];
    if (this.prefs.appearance === "dark" || (this.prefs.appearance === "auto" && this.systemDark.matches)) {
      const probeDark = ["night", "graphite"].includes(selected.id) || /--bg-color:\s*#[0-3]/i.test(selected.css);
      if (!probeDark) return builtinThemes.find(theme => theme.id === "night")!;
    }
    return selected;
  }

  applyThemePreference() {
    applyTheme(this.currentTheme(), this.prefs.customCss);
    this.editor?.refresh();
  }

  setTheme(id: string) {
    this.prefs.theme = id;
    if (this.prefs.appearance === "dark") this.prefs.appearance = "auto";
    this.savePrefs();
    this.applyThemePreference();
    if (this.prefs.appearance === "auto" && this.systemDark.matches && this.currentTheme().id !== id)
      toast("Your device is in dark mode, so the Night theme is shown. Choose “Always Use Selected Theme” in the Themes menu to override.", { timeout: 6000 });
  }

  setAppearance(value: Preferences["appearance"]) {
    this.prefs.appearance = value;
    this.savePrefs();
    this.applyThemePreference();
  }

  async importThemeDialog() {
    const files = await pickFiles(".css,text/css,font/*,.woff,.woff2,.ttf,.otf,image/*", true);
    if (!files.length) return;
    const theme = await importTheme(files);
    await this.loadThemes();
    this.setTheme(theme.id);
    toast(`Theme “${theme.name}” imported.`, { kind: "success" });
  }

  async manageThemes() {
    const custom = this.themes.filter(theme => !theme.builtin);
    const choice = await choiceDialog("Remove imported theme", "Choose a theme to remove.", [
      ...custom.map(theme => ({ label: theme.name, value: theme.id, danger: true })), { label: "Cancel", value: "" },
    ]);
    if (!choice) return;
    await deleteCustomTheme(choice);
    await this.loadThemes();
    if (this.prefs.theme === choice) this.setTheme("github");
  }

  togglePref(key: "focusMode" | "typewriterMode" | "showStatusBar") {
    this.prefs[key] = !this.prefs[key];
    this.savePrefs();
    this.applyPreferences();
    if (key !== "showStatusBar") this.view.focus();
  }

  sidebarOpen() { return this.root.classList.contains("sidebar-open"); }

  setSidebar(open: boolean, remember = true) {
    this.root.classList.toggle("sidebar-open", open);
    if (remember && window.innerWidth > 760) { this.prefs.sidebarVisible = open; this.savePrefs(); }
    if (open) this.sidebar.refresh();
  }

  showSidebarTab(tab: Preferences["sidebarTab"]) {
    if (this.sidebarOpen() && this.prefs.sidebarTab === tab) { this.setSidebar(false); return; }
    this.prefs.sidebarTab = tab;
    this.savePrefs();
    this.setSidebar(true);
    this.sidebar.setTab(tab);
  }

  toggleSource() {
    const next: EditorMode = this.editor.modeName === "live" ? "source" : "live";
    this.editor.setMode(next);
    this.root.classList.toggle("source-mode", next === "source");
    this.statusMode.classList.toggle("active", next === "source");
    this.view.focus();
  }

  setZoom(value: number) {
    this.zoom = Math.min(2, Math.max(0.6, Math.round(value * 10) / 10));
    document.documentElement.style.setProperty("--write-font-size", `${Math.round(this.prefs.fontSize * this.zoom)}px`);
    this.view.requestMeasure();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }

  /* ================= Documents ================= */

  async restoreSession() {
    const recent = await kv.get<Recent[]>("recent");
    this.recentList = recent ?? [];
    let restored: { workspaceId: string } | null = null;
    if (this.prefs.restoreSession) {
      try { restored = await this.docs.restore(); } catch (error) { console.warn("Session restore failed", error); }
    }
    for (const folder of await savedFolders()) if (!this.docs.workspaces.has(folder.id)) this.docs.workspaces.set(folder.id, new FolderWorkspace(folder.id, folder.handle));
    const workspace = restored ? this.docs.workspaces.get(restored.workspaceId) : null;
    if (workspace) await this.setWorkspace(workspace, false);
    else await this.setWorkspace(libraryWorkspace, false);
    const launched = await this.consumeLaunchFiles();
    if (!launched && new URLSearchParams(location.search).has("new")) {
      history.replaceState(null, "", location.pathname);
      await this.newDocument();
    } else if (!launched) {
      if (this.docs.active) await this.activate(this.docs.active, true);
      else if (!restored || !this.docs.docs.length) await this.firstRun();
    }
    if (this.docs.docs.some(doc => doc.pendingPermission)) {
      toast("Typorium needs permission again to open files from your folder.", { timeout: 15000, action: { label: "Allow", run: () => void this.grantPermissions() } });
    }
  }

  async grantPermissions() {
    await this.docs.grantPending();
    if (this.workspace instanceof FolderWorkspace) await ensurePermission(this.workspace.handle, true);
    if (this.doc) await this.activate(this.doc, true);
    this.sidebar.refresh();
  }

  async firstRun() {
    const seen = await kv.get<boolean>("welcomed");
    if (!seen) {
      await kv.set("welcomed", true);
      const exists = await libraryWorkspace.exists("Welcome to Typorium.md");
      if (!exists) await libraryWorkspace.writeText("Welcome to Typorium.md", welcomeDocument);
      await this.openLocation({ kind: "workspace", workspaceId: "library", path: "Welcome to Typorium.md" });
    } else await this.activate(this.docs.createUntitled());
  }

  async openGuide(name: string, content: string) {
    const path = join("Typorium Guides", name);
    if (!(await libraryWorkspace.exists(path))) await libraryWorkspace.writeText(path, content);
    await this.openLocation({ kind: "workspace", workspaceId: "library", path });
  }

  /** Save the editor state back into the active document record. */
  stash() {
    const doc = this.doc;
    if (!doc || this.switching || this.shownId !== doc.id) return;
    doc.state = this.view.state;
    doc.text = this.view.state.doc.toString();
    doc.scrollTop = this.view.scrollDOM.scrollTop;
  }

  async activate(doc: Doc, force = false) {
    if (!force && this.doc === doc && doc.state === this.view.state) return;
    this.stash();
    this.switching = true;
    try {
      if (doc.pendingPermission) {
        const granted = await this.docs.grantPending().catch(() => 0);
        if (!granted && doc.pendingPermission) {
          toast(`Allow access to open “${doc.name}”.`, { action: { label: "Allow", run: () => void this.grantPermissions() } });
        }
      }
      if (!doc.loaded && !doc.pendingPermission) await this.docs.load(doc);
      this.docs.activeId = doc.id;
      this.revokeImageUrls();
      if (!doc.state || doc.state.doc.toString() !== doc.text) doc.state = this.editor.createState(doc.text, EditorSelection.cursor(0));
      this.editor.setState(doc.state);
      this.shownId = doc.id;
      this.view.scrollDOM.scrollTop = doc.scrollTop ?? 0;
    } finally { this.switching = false; }
    this.updateTitle();
    this.updateStats();
    this.sidebar.refresh();
    this.docs.schedulePersist();
    this.addRecent(doc);
  }

  async openLocation(location: DocLocation) {
    const existing = this.docs.findOpen(location);
    if (existing) { await this.activate(existing); return existing; }
    // Replace an empty untitled document instead of piling them up.
    const current = this.doc;
    const doc = await this.docs.openLocation(location);
    if (current && current.location.kind === "untitled" && !current.text.trim() && current !== doc) this.docs.close(current);
    await this.activate(doc);
    if (window.innerWidth <= 760) this.setSidebar(false, false);
    return doc;
  }

  async openWorkspaceFile(workspaceId: string, path: string) {
    if (!isMarkdown(path)) {
      toast(`“${basename(path)}” is not a Markdown file.`);
      return;
    }
    await this.openLocation({ kind: "workspace", workspaceId, path });
  }

  async openRecent(item: Recent) {
    if (item.workspaceId === "handle") return;
    if (!this.docs.workspaces.has(item.workspaceId)) { toast("That folder is no longer available."); return; }
    await this.openWorkspaceFile(item.workspaceId, item.path);
  }

  addRecent(doc: Doc) {
    if (doc.location.kind !== "workspace") return;
    const { workspaceId, path } = doc.location;
    this.recentList = [{ kind: "file" as const, workspaceId, path, name: basename(path), time: Date.now() }, ...this.recentList.filter(item => !(item.kind === "file" && item.workspaceId === workspaceId && item.path === path))].slice(0, 30);
    void kv.set("recent", this.recentList);
  }

  async newDocument() {
    const doc = this.docs.createUntitled();
    await this.activate(doc);
    this.view.focus();
  }

  async openFile() {
    if (fileAccessSupported) {
      let handles: FileSystemFileHandle[];
      try { handles = await (window as unknown as { showOpenFilePicker: OpenFilePicker }).showOpenFilePicker({ multiple: true, types: markdownTypes }); }
      catch (error) { if ((error as DOMException).name === "AbortError") return; throw error; }
      for (const handle of handles) await this.openLocation({ kind: "handle", handle });
      return;
    }
    // iPadOS/Safari/Firefox: copy into the Library so it can be saved.
    const files = await pickFiles(".md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain", true);
    for (const file of files) await this.importIntoLibrary(file);
  }

  async importIntoLibrary(file: File, convert?: (text: string) => string) {
    const raw = await file.text();
    const text = convert ? convert(raw) : raw;
    const name = convert ? stem(file.name) + ".md" : file.name;
    const target = this.workspace;
    const directory = this.sidebar.selectedDirectory();
    const path = await this.docs.uniquePath(target, directory, name);
    await target.writeText(path, text);
    toast(`Saved a copy of “${file.name}” to ${target.name}.`, { kind: "success" });
    await this.openWorkspaceFile(target.id, path);
  }

  async importFiles() {
    const files = await pickFiles(".md,.markdown,.mdown,.txt,.html,.htm,text/html,text/markdown,text/plain", true);
    for (const file of files) {
      if (/\.html?$/i.test(file.name) || file.type === "text/html") await this.importIntoLibrary(file, htmlToMarkdown);
      else await this.importIntoLibrary(file);
    }
  }

  async openFolder() {
    if (!folderAccessSupported) {
      await modal({ title: "Folders aren't available here", body: "This browser can't open folders from your disk. Your documents are kept in Typorium's Library instead — use File › Open to bring files in, and Export to save copies out. In Chrome or Edge (or the installed app on a desktop), you can open real folders.", buttons: [{ label: "OK", value: "ok", primary: true }] });
      return;
    }
    let handle: FileSystemDirectoryHandle;
    try { handle = await (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker({ mode: "readwrite", id: "typorium-folder" }); }
    catch (error) { if ((error as DOMException).name === "AbortError") return; throw error; }
    const workspace = await rememberFolder(handle);
    this.docs.workspaces.set(workspace.id, workspace);
    await this.setWorkspace(workspace);
    this.recentList = [{ kind: "folder" as const, workspaceId: workspace.id, path: "", name: workspace.name, time: Date.now() }, ...this.recentList.filter(item => item.workspaceId !== workspace.id || item.kind !== "folder")].slice(0, 30);
    void kv.set("recent", this.recentList);
  }

  async switchWorkspace(id: string) {
    const workspace = this.docs.workspaces.get(id);
    if (!workspace) return;
    if (workspace instanceof FolderWorkspace && !(await ensurePermission(workspace.handle, true))) { toast("Permission to open the folder was denied."); return; }
    await this.setWorkspace(workspace);
  }

  async setWorkspace(workspace: Workspace, open = true) {
    this.workspace = workspace;
    this.docs.currentWorkspaceId = workspace.id;
    this.docs.schedulePersist();
    await this.sidebar.setWorkspace(workspace);
    if (open) this.setSidebar(true);
  }

  async forgetWorkspace(id: string) {
    await forgetFolder(id);
    this.docs.workspaces.delete(id);
    if (this.workspace.id === id) await this.setWorkspace(libraryWorkspace);
    this.sidebar.refresh();
  }

  async save(doc = this.doc): Promise<boolean> {
    if (!doc) return false;
    if (doc === this.doc) this.stash();
    if (doc.location.kind === "untitled") return this.saveAs(doc);
    if (doc.pendingPermission) { await this.grantPermissions(); if (doc.pendingPermission) return false; }
    if (await this.docs.externalChange(doc)) {
      const choice = await choiceDialog("File changed on disk", `“${doc.name}” was changed by another app since it was opened. Overwrite it with your version?`, [
        { label: "Cancel", value: "cancel" }, { label: "Reload from Disk", value: "reload" }, { label: "Overwrite", value: "overwrite", danger: true },
      ]);
      if (choice === "reload") { await this.reload(doc); return false; }
      if (choice !== "overwrite") return false;
    }
    await this.docs.save(doc);
    this.updateTitle();
    this.sidebar.refreshSoon();
    return true;
  }

  async saveAs(doc = this.doc): Promise<boolean> {
    if (!doc) return false;
    if (doc === this.doc) this.stash();
    const choices = [
      { label: `Save in ${this.workspace.name}`, value: "workspace", primary: true },
      ...(window.showSaveFilePicker ? [{ label: "Save to Disk…", value: "disk" }] : []),
      { label: isIOS ? "Export to Files…" : "Download a Copy", value: "download" },
      { label: "Cancel", value: "cancel" },
    ];
    const target = await choiceDialog("Save As", `Where should “${doc.name}” be saved?`, choices);
    if (target === "workspace") {
      const suggested = doc.location.kind === "untitled" ? (this.suggestName(doc) + ".md") : doc.name;
      const name = await promptDialog("Save As", "File name", suggested, { selectStem: true, confirmLabel: "Save" });
      if (!name) return false;
      const directory = this.sidebar.selectedDirectory();
      const fileName = isMarkdown(name) ? name : name + ".md";
      let path = join(directory, fileName);
      if (await this.workspace.exists(path)) {
        if (!(await confirmDialog("Replace file?", `“${fileName}” already exists. Replace it?`, "Replace", true))) path = await this.docs.uniquePath(this.workspace, directory, fileName);
      }
      await this.docs.saveTo(doc, { kind: "workspace", workspaceId: this.workspace.id, path });
    } else if (target === "disk") {
      let handle: FileSystemFileHandle;
      try { handle = await (window as unknown as { showSaveFilePicker: SaveFilePicker }).showSaveFilePicker({ suggestedName: doc.location.kind === "untitled" ? this.suggestName(doc) + ".md" : doc.name, types: markdownTypes }); }
      catch (error) { if ((error as DOMException).name === "AbortError") return false; throw error; }
      await this.docs.saveTo(doc, { kind: "handle", handle });
    } else if (target === "download") {
      await this.exportMarkdown();
      return false;
    } else return false;
    this.updateTitle();
    this.sidebar.refreshSoon();
    this.addRecent(doc);
    toast(`Saved “${doc.name}”.`, { kind: "success" });
    return true;
  }

  suggestName(doc: Doc) {
    const heading = /^#{1,6}\s+(.+)$/m.exec(doc.text)?.[1] ?? doc.text.split("\n").find(line => line.trim())?.trim() ?? "Untitled";
    return heading.replace(/[\\/:*?"<>|#^[\]]/g, "").slice(0, 60).trim() || "Untitled";
  }

  async reload(doc: Doc) {
    await this.docs.load(doc);
    if (doc === this.doc) await this.activate(doc, true);
  }

  async closeDocument(doc = this.doc) {
    if (!doc) return;
    if (doc === this.doc) this.stash();
    if (this.docs.isDirty(doc)) {
      const choice = await choiceDialog("Unsaved changes", `Save changes to “${doc.name}” before closing?`, [
        { label: "Cancel", value: "cancel" }, { label: "Don't Save", value: "discard", danger: true }, { label: "Save", value: "save", primary: true },
      ]);
      if (choice === "save") { if (!(await this.save(doc))) return; }
      else if (choice !== "discard") return;
    }
    const wasActive = doc === this.doc;
    this.docs.close(doc);
    if (wasActive) {
      const next = this.docs.active ?? this.docs.createUntitled();
      await this.activate(next, true);
    }
    this.sidebar.refresh();
  }

  async renameCurrent() {
    const doc = this.doc;
    if (!doc || doc.location.kind !== "workspace") return;
    await this.renamePath(doc.location.workspaceId, doc.location.path);
  }

  async renamePath(workspaceId: string, path: string) {
    const workspace = this.docs.workspaces.get(workspaceId);
    if (!workspace) return;
    const name = await promptDialog("Rename", "New name", basename(path), { selectStem: true, confirmLabel: "Rename" });
    if (!name || name === basename(path)) return;
    if (/[\\/]/.test(name)) { toast("Names can't contain slashes.", { kind: "error" }); return; }
    const target = join(dirname(path), name);
    for (const doc of this.docs.docs) if (doc.location.kind === "workspace" && doc.location.path === path && this.docs.isDirty(doc)) await this.save(doc);
    await workspace.rename(path, target);
    this.docs.renamed(workspaceId, path, target);
    this.updateTitle();
    this.sidebar.refresh();
  }

  async moveCurrent() {
    const doc = this.doc;
    if (!doc || doc.location.kind !== "workspace") return;
    const workspace = this.docs.workspaceOf(doc)!;
    const tree = await workspace.tree();
    const folders: string[] = [""];
    const walk = (entry: typeof tree) => { for (const child of entry.children ?? []) if (child.kind === "directory") { folders.push(child.path); walk(child); } };
    walk(tree);
    const select = h("select", { class: "text-input" }, ...folders.map(folder => h("option", { value: folder }, folder ? folder : `${workspace.name} (top level)`)));
    select.value = dirname(doc.location.path);
    const result = await modal<string | null>({
      title: "Move To", body: h("label", { class: "form-field" }, h("span", null, "Folder"), select), dismissValue: null,
      buttons: [{ label: "Cancel", value: "cancel" }, { label: "Move", value: "move", primary: true }],
      resolveButton: value => value === "move" ? select.value : null,
    });
    if (result === null || result === dirname(doc.location.path)) return;
    const target = join(result, basename(doc.location.path));
    if (this.docs.isDirty(doc)) await this.save(doc);
    await workspace.rename(doc.location.path, target);
    this.docs.renamed(workspace.id, doc.location.path, target);
    this.updateTitle();
    this.sidebar.refresh();
  }

  async deleteCurrent() {
    const doc = this.doc;
    if (!doc || doc.location.kind !== "workspace") return;
    await this.deletePath(doc.location.workspaceId, doc.location.path);
  }

  async deletePath(workspaceId: string, path: string, isFolder = false) {
    const workspace = this.docs.workspaces.get(workspaceId);
    if (!workspace) return;
    const ok = await confirmDialog(isFolder ? "Delete folder?" : "Delete file?", `“${basename(path)}”${isFolder ? " and everything in it" : ""} will be permanently deleted${workspace.kind === "folder" ? " from your disk" : ""}. This can't be undone.`, "Delete", true);
    if (!ok) return;
    await workspace.remove(path);
    for (const doc of [...this.docs.docs]) {
      if (doc.location.kind === "workspace" && doc.location.workspaceId === workspaceId && (doc.location.path === path || doc.location.path.startsWith(path + "/"))) {
        doc.savedText = doc.text;
        const wasActive = doc === this.doc;
        this.docs.close(doc);
        if (wasActive) await this.activate(this.docs.active ?? this.docs.createUntitled(), true);
      }
    }
    this.sidebar.refresh();
  }

  async newFileIn(workspaceId: string, directory: string) {
    const workspace = this.docs.workspaces.get(workspaceId);
    if (!workspace) return;
    const name = await promptDialog("New File", "File name", "Untitled.md", { selectStem: true, confirmLabel: "Create" });
    if (!name) return;
    const path = await this.docs.uniquePath(workspace, directory, isMarkdown(name) ? name : name + ".md");
    await workspace.writeText(path, "");
    this.sidebar.refresh();
    await this.openWorkspaceFile(workspaceId, path);
    this.view.focus();
  }

  async newFolderIn(workspaceId: string, directory: string) {
    const workspace = this.docs.workspaces.get(workspaceId);
    if (!workspace) return;
    const name = await promptDialog("New Folder", "Folder name", "New Folder", { confirmLabel: "Create" });
    if (!name) return;
    await workspace.createFolder(join(directory, name));
    this.sidebar.refresh();
  }

  async duplicatePath(workspaceId: string, path: string) {
    const workspace = this.docs.workspaces.get(workspaceId);
    if (!workspace) return;
    const target = await this.docs.uniquePath(workspace, dirname(path), `${stem(path)} copy${extname(path)}`);
    await workspace.writeText(target, await workspace.readText(path));
    this.sidebar.refresh();
  }

  revealCurrent() {
    this.setSidebar(true);
    this.sidebar.setTab("files");
    this.sidebar.reveal();
  }

  /* ================= Editing callbacks ================= */

  onDocChanged() {
    const doc = this.doc;
    if (!doc || this.switching || this.shownId !== doc.id) return;
    doc.text = this.view.state.doc.toString();
    doc.state = this.view.state;
    this.updateTitle();
    this.docs.schedulePersist();
    clearTimeout(this.statsTimer);
    this.statsTimer = window.setTimeout(() => this.updateStats(), 300);
    clearTimeout(this.outlineTimer);
    this.outlineTimer = window.setTimeout(() => this.sidebar.refreshOutline(), 400);
    if (this.prefs.autoSave && doc.location.kind !== "untitled") {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = window.setTimeout(() => {
        if (this.doc === doc && this.docs.isDirty(doc) && !this.view.composing) void this.docs.save(doc).then(() => this.updateTitle()).catch(error => this.error(error));
      }, 1500);
    }
  }

  onSelectionChanged() {
    this.formatBar.updateState();
    clearTimeout(this.statsTimer);
    this.statsTimer = window.setTimeout(() => { this.updateStats(); this.sidebar.highlightOutline(); }, 200);
  }

  updateTitle() {
    const doc = this.doc;
    const dirty = doc ? this.docs.isDirty(doc) : false;
    const name = doc?.name ?? "Typorium";
    const location = doc?.location.kind === "workspace" ? `${this.docs.workspaces.get(doc.location.workspaceId)?.name ?? ""} › ${doc.location.path}` : doc?.location.kind === "handle" ? "File on disk" : "Not saved yet";
    this.titleElement.replaceChildren(h("span", { class: "doc-name" }, name), dirty ? h("span", { class: "dirty-dot", title: "Unsaved changes" }, "•") : "");
    this.titleElement.title = location;
    document.title = `${dirty ? "• " : ""}${name} — Typorium`;
    this.sidebar.markActive();
  }

  updateStats() {
    const state = this.view.state;
    const range = state.selection.main;
    const stats = documentStats(range.empty ? state.doc.toString() : state.sliceDoc(range.from, range.to), this.prefs.readingSpeed);
    this.statusWords.textContent = range.empty ? `${stats.words.toLocaleString()} words` : `${stats.words.toLocaleString()} of ${documentStats(state.doc.toString()).words.toLocaleString()} words`;
  }

  showStats() {
    const state = this.view.state;
    const all = documentStats(state.doc.toString(), this.prefs.readingSpeed);
    const range = state.selection.main;
    const selected = range.empty ? null : documentStats(state.sliceDoc(range.from, range.to), this.prefs.readingSpeed);
    const row = (label: string, value: string | number) => h("tr", null, h("th", null, label), h("td", null, typeof value === "number" ? value.toLocaleString() : value));
    const doc = this.doc;
    const table = h("table", { class: "stats-table" },
      row("Words", all.words), row("Characters", all.characters), row("Characters (no spaces)", all.charactersNoSpaces),
      row("Paragraphs", all.paragraphs), row("Lines", all.lines), row("Reading time", `${all.minutes} min`),
      ...(selected ? [row("Selected words", selected.words), row("Selected characters", selected.characters)] : []),
      row("Location", doc?.location.kind === "workspace" ? `${this.docs.workspaces.get(doc.location.workspaceId)?.name} › ${doc.location.path}` : doc?.location.kind === "handle" ? "File on disk" : "Not saved"),
      row("Line endings", doc?.crlf ? "CRLF (Windows)" : "LF"), row("Encoding", doc?.bom ? "UTF-8 with BOM" : "UTF-8"));
    void modal({ title: doc?.name ?? "Document", body: table, buttons: [{ label: "Close", value: "close", primary: true }] });
  }

  /* ================= Links, images, files ================= */

  openLink(href: string) {
    if (href.startsWith("#")) {
      const target = decodeURIComponent(href.slice(1)).toLowerCase();
      const heading = collectHeadings(this.view.state).find(entry => entry.text.toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "") === target || entry.text.toLowerCase() === target);
      if (heading) { this.view.dispatch({ selection: EditorSelection.cursor(heading.pos), effects: EditorView.scrollIntoView(heading.pos, { y: "start", yMargin: 40 }) }); this.view.focus(); }
      else toast(`No heading “${decodeURIComponent(href.slice(1))}” in this document.`);
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { window.open(href, "_blank", "noopener,noreferrer"); return; }
    // Relative link to another Markdown file in the same workspace.
    const doc = this.doc;
    if (doc?.location.kind === "workspace") {
      const [pathPart, anchor] = href.split("#");
      const path = normalize(join(dirname(doc.location.path), decodeURIComponent(pathPart)));
      if (isMarkdown(path) || !extname(path)) {
        const target = extname(path) ? path : path + ".md";
        void (async () => {
          const workspace = this.docs.workspaceOf(doc)!;
          if (!(await workspace.exists(target))) {
            if (await confirmDialog("Create file?", `“${target}” doesn't exist yet. Create it?`, "Create")) await workspace.writeText(target, "");
            else return;
            this.sidebar.refresh();
          }
          await this.openWorkspaceFile(workspace.id, target);
          if (anchor) this.openLink("#" + anchor);
        })();
        return;
      }
    }
    toast(`Can't open “${href}” from here.`);
  }

  private revokeImageUrls() {
    for (const url of this.imageUrls.values()) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    this.imageUrls.clear();
  }

  /** Typora's front matter keys: typora-root-url and typora-copy-images-to. */
  frontMatterValue(key: string) {
    const head = this.view.state.sliceDoc(0, 4000);
    const match = /^---\n([\s\S]*?)\n(?:---|\.\.\.)/.exec(head);
    if (!match) return null;
    const line = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(match[1]);
    return line ? line[1].trim().replace(/^["']|["']$/g, "") : null;
  }

  resolveImage(src: string): string | Promise<string | null> | null {
    if (/^(https?:|data:|blob:)/i.test(src)) return src;
    if (src.startsWith("//")) return "https:" + src;
    const doc = this.doc;
    if (!doc || doc.location.kind !== "workspace") return null;
    const workspace = this.docs.workspaceOf(doc);
    if (!workspace) return null;
    let decoded = src;
    try { decoded = decodeURI(src); } catch { /* keep raw */ }
    decoded = decoded.replace(/^file:\/\//, "").split(/[?#]/)[0];
    const root = this.frontMatterValue("typora-root-url");
    const base = decoded.startsWith("/") && root ? join(dirname(doc.location.path), root) : dirname(doc.location.path);
    const path = normalize(join(base, decoded.startsWith("/") && !root ? decoded.slice(1) : decoded));
    const key = `${workspace.id}:${path}`;
    const cached = this.imageUrls.get(key);
    if (cached) return cached;
    return workspace.readBlob(path).then(blob => {
      if (!blob) return null;
      const typed = blob.type ? blob : new Blob([blob], { type: extname(path) === ".svg" ? "image/svg+xml" : "" });
      const url = URL.createObjectURL(typed);
      this.imageUrls.set(key, url);
      return url;
    });
  }

  /** Paste/drop of image files: copy into the document's assets folder like Typora. */
  insertFiles(view: EditorView, files: File[], pos: number | null): boolean {
    const images = files.filter(file => file.type.startsWith("image/"));
    const markdownFiles = files.filter(file => isMarkdown(file.name) && !file.type.startsWith("image/"));
    if (!images.length && !markdownFiles.length) return false;
    void (async () => {
      for (const file of markdownFiles) await this.importIntoLibrary(file);
      if (!images.length) return;
      if (pos !== null) view.dispatch({ selection: EditorSelection.cursor(pos) });
      for (const file of images) {
        const src = await this.storeImage(file);
        cmd.insertImageMarkdown(view, src, "");
        if (images.length > 1) view.dispatch(view.state.replaceSelection("\n\n"));
      }
    })().catch(error => this.error(error));
    return true;
  }

  async storeImage(file: File): Promise<string> {
    const doc = this.doc;
    const workspace = doc ? this.docs.workspaceOf(doc) : null;
    if (!doc || !workspace || this.prefs.imageInsert === "data-uri") {
      if (doc && !workspace && this.prefs.imageInsert !== "data-uri") toast("Save the document to a folder or the Library to keep images as separate files. This image was embedded in the document.", { timeout: 6000 });
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    }
    const docDir = docDirectory(doc);
    const copyTo = this.frontMatterValue("typora-copy-images-to");
    let folder = copyTo ?? (this.prefs.imageInsert === "filename-assets" ? "./${filename}.assets" : this.prefs.imageInsert === "custom" ? this.prefs.imageFolder : "./assets");
    folder = folder.replace(/\$\{filename\}/g, stem(doc.name));
    const directory = join(docDir, folder);
    const ext = extname(file.name) || "." + (file.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
    const original = file.name && file.name !== "image.png" ? stem(file.name) : `image-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
    let path = join(directory, original + ext);
    for (let i = 1; await workspace.exists(path); i++) path = join(directory, `${original}-${i}${ext}`);
    await workspace.writeBlob(path, file);
    this.sidebar.refreshSoon();
    return encodePath(relative(docDir, path));
  }

  async insertImageDialog() {
    const url = h("input", { type: "text", class: "text-input", placeholder: "https://… or a relative path", autocapitalize: "off", spellcheck: false });
    const alt = h("input", { type: "text", class: "text-input", placeholder: "Description (alt text)" });
    const body = h("div", { class: "form-stack" },
      h("label", { class: "form-field" }, h("span", null, "Image URL or path"), url),
      h("label", { class: "form-field" }, h("span", null, "Alt text"), alt));
    const result = await modal<string | null>({
      title: "Insert Image", body, dismissValue: null,
      buttons: [{ label: "Choose File…", value: "file" }, { label: "Cancel", value: "cancel" }, { label: "Insert", value: "insert", primary: true }],
    });
    if (result === "insert" && url.value.trim()) cmd.insertImageMarkdown(this.view, url.value.trim(), alt.value.trim());
    else if (result === "file") {
      const files = await pickFiles("image/*", true);
      for (const file of files) cmd.insertImageMarkdown(this.view, await this.storeImage(file), alt.value.trim());
    }
    this.view.focus();
  }

  async insertTableDialog() {
    const rows = h("input", { type: "number", class: "text-input", min: "1", max: "100", value: "3" });
    const cols = h("input", { type: "number", class: "text-input", min: "1", max: "30", value: "3" });
    const body = h("div", { class: "form-row" },
      h("label", { class: "form-field" }, h("span", null, "Columns"), cols),
      h("label", { class: "form-field" }, h("span", null, "Rows"), rows));
    const result = await modal<string | null>({ title: "Insert Table", body, dismissValue: null, buttons: [{ label: "Cancel", value: "cancel" }, { label: "Insert", value: "ok", primary: true }],
      onOpen(dialog, close) { dialog.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); close("ok"); } }); } });
    if (result !== "ok") return;
    cmd.insertTable(this.view, Math.max(1, Math.min(100, Number(rows.value) || 3)) - 1 || 1, Math.max(1, Math.min(30, Number(cols.value) || 3)));
  }

  insertEmoji() {
    this.view.focus();
    this.view.dispatch(this.view.state.replaceSelection(":"));
    startCompletion(this.view);
    toast("Type an emoji name after the colon, e.g. :smile:");
  }

  async paste(plain: boolean) {
    this.view.focus();
    try {
      if (!plain && navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const image = item.types.find(type => type.startsWith("image/"));
          if (image) { const blob = await item.getType(image); this.insertFiles(this.view, [new File([blob], "image." + image.split("/")[1], { type: image })], null); return; }
          if (item.types.includes("text/html")) {
            const html = await (await item.getType("text/html")).text();
            this.view.dispatch(this.view.state.replaceSelection(htmlToMarkdown(html)), { userEvent: "input.paste", scrollIntoView: true });
            return;
          }
        }
      }
      const text = await navigator.clipboard.readText();
      this.view.dispatch(this.view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
    } catch {
      toast(`Use ${shortcutLabel(plain ? "Mod-Shift-v" : "Mod-v")} to paste — the browser blocked clipboard access.`);
    }
  }

  async copyMarkdown() {
    const state = this.view.state;
    const range = state.selection.main;
    const text = range.empty ? state.doc.toString() : state.sliceDoc(range.from, range.to);
    await navigator.clipboard.writeText(text);
    toast(range.empty ? "Copied the whole document as Markdown." : "Copied as Markdown.");
  }

  async copyHtml() {
    const state = this.view.state;
    const range = state.selection.main;
    const text = range.empty ? state.doc.toString() : state.sliceDoc(range.from, range.to);
    await navigator.clipboard.writeText(markdownToClipboardHtml(text));
    toast("Copied as HTML code.");
  }

  /* ================= Export ================= */

  exportContext() {
    return {
      title: this.doc ? stem(this.doc.name) : "Document",
      resolveImage: async (src: string) => (await this.resolveImage(src)) ?? null,
      css: this.prefs.exportIncludeTheme ? exportCss(this.currentTheme(), this.prefs.customCss) : exportCss(builtinThemes[0]),
    };
  }

  async exportHtml(withStyles: boolean) {
    this.stash();
    const html = await exportHtml(this.view.state.doc.toString(), this.exportContext(), withStyles);
    await saveBlob(new Blob([html], { type: "text/html" }), `${this.exportContext().title}.html`, isIOS);
  }

  async exportMarkdown() {
    const doc = this.doc;
    if (!doc) return;
    this.stash();
    const name = doc.location.kind === "untitled" ? this.suggestName(doc) + ".md" : doc.name;
    const data = (doc.bom ? "﻿" : "") + (doc.crlf ? doc.text.replace(/\n/g, "\r\n") : doc.text);
    await saveBlob(new Blob([data], { type: "text/markdown" }), name, isIOS);
  }

  async print() {
    this.stash();
    await printDocument(this.view.state.doc.toString(), this.exportContext(), { size: this.prefs.pdfPageSize, margin: this.prefs.pdfMargin });
  }

  /* ================= Global events, PWA ================= */

  bindGlobalEvents() {
    window.addEventListener("beforeunload", event => {
      this.stash();
      void this.docs.persist();
      const unsaved = this.docs.docs.some(doc => this.docs.isDirty(doc) && doc.location.kind !== "untitled");
      if (unsaved && !this.prefs.autoSave) { event.preventDefault(); event.returnValue = ""; }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") { this.stash(); void this.docs.persist(); }
      else void this.checkExternalChange();
    });
    window.addEventListener("focus", () => void this.checkExternalChange());
    // Shortcuts when focus is outside the editor (sidebar, title bar, ...).
    document.addEventListener("keydown", event => {
      if (event.defaultPrevented) return;
      if (this.view.hasFocus || (event.target as HTMLElement).closest?.(".modal, .cm-panels, .md-table-wrap, input, textarea, select")) return;
      const key = eventKey(event);
      for (const command of this.commands.values()) {
        if (command.key && command.key === key && !command.id.startsWith("edit.") && !command.id.startsWith("fmt.") && !command.id.startsWith("para.")) {
          event.preventDefault();
          this.run(command.id);
          return;
        }
      }
    });
    // Track the modifier key so links can show a pointer cursor while held.
    const mod = (event: KeyboardEvent) => this.root.classList.toggle("mod-key-down", isApple ? event.metaKey : event.ctrlKey);
    document.addEventListener("keydown", mod);
    document.addEventListener("keyup", mod);
    window.addEventListener("resize", () => { if (window.innerWidth <= 760 && this.sidebarOpen() && document.activeElement && this.view.contentDOM.contains(document.activeElement)) this.setSidebar(false, false); });
    // Right-click context menu in the editor (desktop).
    this.view.contentDOM.addEventListener("contextmenu", event => {
      if (isTouch && !matchMedia("(pointer: fine)").matches) return;
      if ((event.target as HTMLElement).closest(".md-table-wrap, input")) return;
      event.preventDefault();
      showMenu(this.contextMenuItems(), { x: event.clientX, y: event.clientY });
    });
  }

  contextMenuItems(): MenuItem[] {
    const has = !this.view.state.selection.main.empty;
    return [
      { label: "Cut", disabled: !has, run: () => this.run("edit.cut") },
      { label: "Copy", disabled: !has, run: () => this.run("edit.copy") },
      { label: "Paste", run: () => this.run("edit.paste") },
      { label: "Copy as Markdown", run: () => this.run("edit.copyMarkdown") },
      { separator: true },
      ...this.menuItems(["fmt.strong", "fmt.emphasis", "fmt.code", "fmt.link"]),
      { label: "Format", submenu: () => this.menuItems(menuBar.find(menu => menu.id === "format")!.items as MenuEntry[]) },
      { label: "Paragraph", submenu: () => this.menuItems(menuBar.find(menu => menu.id === "paragraph")!.items as MenuEntry[]) },
      { label: "Insert", submenu: () => this.menuItems(["para.table", "para.code", "para.math", "fmt.image", "para.hr", "para.footnote", "para.toc"]) },
      { separator: true },
      ...this.menuItems(["view.source"]),
    ];
  }

  private checking = false;
  async checkExternalChange() {
    const doc = this.doc;
    if (!doc || this.checking) return;
    this.checking = true;
    try {
      if (!(await this.docs.externalChange(doc))) return;
      if (!this.docs.isDirty(doc)) { await this.reload(doc); toast(`“${doc.name}” was updated from disk.`); return; }
      const choice = await choiceDialog("File changed on disk", `“${doc.name}” was changed outside Typorium, and you have unsaved edits.`, [
        { label: "Keep My Version", value: "keep" }, { label: "Reload from Disk", value: "reload", danger: true },
      ]);
      if (choice === "reload") await this.reload(doc);
      else doc.diskMtime = undefined;
    } finally { this.checking = false; }
  }

  setupPwa() {
    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      this.installPrompt = event as Event & { prompt(): Promise<void> };
    });
    window.addEventListener("appinstalled", () => { this.installPrompt = null; toast("Typorium is installed.", { kind: "success" }); });
  }

  /** Files opened from the OS with the installed PWA (File Handling API). */
  async consumeLaunchFiles(): Promise<boolean> {
    const launchQueue = (window as unknown as { launchQueue?: { setConsumer(consumer: (params: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
    if (!launchQueue) return false;
    return new Promise(resolve => {
      let handled = false;
      launchQueue.setConsumer(params => {
        if (!params.files?.length) { if (!handled) resolve(false); return; }
        handled = true;
        void (async () => { for (const handle of params.files) await this.openLocation({ kind: "handle", handle }); resolve(true); })();
      });
      setTimeout(() => { if (!handled) resolve(false); }, 150);
    });
  }

  async install() {
    if (isStandalone) { toast("Typorium is already running as an installed app."); return; }
    if (this.installPrompt) { await this.installPrompt.prompt(); return; }
    const steps = isIOS
      ? "In Safari, tap the Share button, then “Add to Home Screen”. Typorium then opens full screen, works offline, and keeps your Library safe from Safari's storage clean-up."
      : "Use your browser's “Install app” option (the install icon in the address bar in Chrome or Edge, or File › Add to Dock in Safari on macOS).";
    await modal({ title: "Install Typorium", body: steps, buttons: [{ label: "OK", value: "ok", primary: true }] });
  }

  showShortcuts() {
    const groups: [string, string[]][] = [
      ["File", ["file.new", "file.open", "file.quickOpen", "file.save", "file.saveAs"]],
      ["Paragraph", ["para.h1", "para.h2", "para.h3", "para.paragraph", "para.headingUp", "para.headingDown", "para.table", "para.code", "para.math", "para.quote", "para.orderedList", "para.bulletList", "para.indent", "para.outdent"]],
      ["Format", ["fmt.strong", "fmt.emphasis", "fmt.underline", "fmt.code", "fmt.strike", "fmt.highlight", "fmt.link", "fmt.image", "fmt.clear"]],
      ["Edit", ["edit.find", "edit.replace", "edit.selectScope", "edit.selectLine", "edit.selectWord", "edit.copyMarkdown", "edit.pastePlain", "edit.searchFiles"]],
      ["View", ["view.source", "view.sidebar", "view.outline", "view.focus", "view.typewriter", "view.commandPalette"]],
    ];
    const body = h("div", { class: "shortcut-grid" }, ...groups.map(([title, ids]) => h("section", null, h("h3", null, title),
      h("table", null, ...ids.map(id => this.commands.get(id)).filter(Boolean).map(command => h("tr", null, h("td", null, command!.label), h("td", null, h("kbd", null, shortcutLabel(command!.key)))))))));
    void modal({ title: "Keyboard Shortcuts", body, className: "modal-wide", buttons: [{ label: "Close", value: "close", primary: true }] });
  }

  showStorageInfo() {
    const body = h("div", { class: "prose" },
      h("p", null, h("strong", null, "Library. "), "Documents in the Library are stored inside this browser on this device (IndexedDB). They work offline and on iPad, but they are not synced and are removed if you clear this site's data. Use Export to keep copies elsewhere."),
      h("p", null, h("strong", null, "Folders. "), folderAccessSupported ? "You can open a real folder on your disk (File › Open Folder). Typorium reads and writes the Markdown files and images there directly." : "This browser can't open folders on your disk, so documents live in the Library. Chrome and Edge on desktop support real folders."),
      h("p", null, h("strong", null, "iPad. "), "Add Typorium to your Home Screen so Safari treats its storage as an installed app's and doesn't clear it after periods of inactivity. Use File › Open to import from the Files app and Export (Share → Save to Files) to write back."),
    );
    void modal({ title: "Where are my files?", body, buttons: [{ label: "OK", value: "ok", primary: true }] });
  }

  about() {
    const body = h("div", { class: "about" },
      h("img", { src: "./icons/icon.svg", alt: "", width: "72", height: "72" }),
      h("h3", null, "Typorium"),
      h("p", null, `Version ${__APP_VERSION__}`),
      h("p", null, "A Typora-style WYSIWYG Markdown editor for the web. Your documents stay on your device."),
      h("p", { class: "muted" }, "Built with CodeMirror, markdown-it, MathJax and Mermaid. Typorium is not affiliated with Typora."));
    void modal({ title: "About", body, buttons: [{ label: "OK", value: "ok", primary: true }] });
  }

  async decodeDroppedText(file: File) { return decodeText(await file.text()).text; }
}

declare global {
  const __APP_VERSION__: string;
  interface Window { showSaveFilePicker?: unknown }
}

/** Convert a keyboard event into CodeMirror-style key notation for matching. */
function eventKey(event: KeyboardEvent) {
  const parts: string[] = [];
  const mod = isApple ? event.metaKey : event.ctrlKey;
  if (mod) parts.push("Mod");
  if (isApple && event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  let key = event.key;
  if (key.length === 1) key = key.toLowerCase();
  if (event.shiftKey && /^Digit\d$/.test(event.code)) key = event.code.slice(5);
  parts.push(key);
  return parts.join("-");
}
