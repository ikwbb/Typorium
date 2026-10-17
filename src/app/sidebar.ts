// Sidebar: file tree (with workspace switcher), document outline, and search
// across the workspace's Markdown files. Mirrors Typora's sidebar panes.
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { App } from "./app";
import { h, icon, icons } from "./dom";
import { showMenu, type MenuItem } from "./ui";
import { isTouch } from "./platform";
import { collectHeadings } from "../editor/blocks";
import type { Entry, Workspace } from "../storage/workspace";
import { libraryWorkspace, folderAccessSupported, FolderWorkspace } from "../storage/workspace";
import { dirname, isMarkdown } from "../storage/paths";
import type { Preferences } from "./prefs";

type Tab = Preferences["sidebarTab"];

interface SearchHit { path: string; name: string; line: number; text: string; from: number; to: number; offset: number }

/** Run `handler` on right-click and on a touch long-press. */
export function onContextMenu(element: HTMLElement, handler: (x: number, y: number) => void) {
  element.addEventListener("contextmenu", event => { event.preventDefault(); handler(event.clientX, event.clientY); });
  let timer = 0;
  let start: { x: number; y: number } | null = null;
  element.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse") return;
    start = { x: event.clientX, y: event.clientY };
    timer = window.setTimeout(() => {
      timer = 0;
      element.dataset.longPress = "1";
      handler(start!.x, start!.y);
    }, 520);
  });
  const cancel = () => { if (timer) clearTimeout(timer); timer = 0; };
  element.addEventListener("pointermove", event => { if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancel(); });
  element.addEventListener("pointerup", cancel);
  element.addEventListener("pointercancel", cancel);
  // Swallow the click that follows a long-press.
  element.addEventListener("click", event => { if (element.dataset.longPress) { delete element.dataset.longPress; event.preventDefault(); event.stopImmediatePropagation(); } }, true);
}

export class Sidebar {
  element: HTMLElement;
  private tab: Tab = "files";
  private tabs = new Map<Tab, HTMLButtonElement>();
  private panes = new Map<Tab, HTMLElement>();
  private workspace: Workspace = libraryWorkspace;
  private workspaceButton: HTMLButtonElement;
  private treeElement: HTMLElement;
  private openList: HTMLElement;
  private outlineElement: HTMLElement;
  private searchInput: HTMLInputElement;
  private searchResults: HTMLElement;
  private searchCase = false;
  private searchWord = false;
  private searchRegex = false;
  private expanded = new Set<string>();
  private selectedDir: string | null = null;
  private tree: Entry | null = null;
  private refreshTimer = 0;
  private searchTimer = 0;
  private searchToken = 0;
  private collapsedOutline = new Set<number>();

  constructor(private app: App) {
    const tabBar = h("div", { class: "sidebar-tabs", role: "tablist" });
    const addTab = (id: Tab, label: string, glyph: string) => {
      const button = h("button", { type: "button", role: "tab", class: "sidebar-tab", title: label, onclick: () => { this.app.prefs.sidebarTab = id; this.app.savePrefs(); this.setTab(id); } }, icon(glyph, 15), h("span", null, label));
      this.tabs.set(id, button);
      tabBar.append(button);
    };
    addTab("files", "Files", icons.folder);
    addTab("outline", "Outline", icons.outline);
    addTab("search", "Search", icons.search);

    // Files pane
    this.workspaceButton = h("button", { type: "button", class: "workspace-button", title: "Switch workspace", onclick: () => this.workspaceMenu() });
    const fileActions = h("div", { class: "pane-actions" },
      h("button", { type: "button", class: "icon-button", title: "New file", "aria-label": "New file", onclick: () => void this.app.newFileIn(this.workspace.id, this.selectedDirectory()) }, icon(icons.plus, 15)),
      h("button", { type: "button", class: "icon-button", title: "New folder", "aria-label": "New folder", onclick: () => void this.app.newFolderIn(this.workspace.id, this.selectedDirectory()) }, icon(icons.folder, 15)),
      h("button", { type: "button", class: "icon-button", title: "Refresh", "aria-label": "Refresh", onclick: () => this.refresh() }, icon(icons.refresh, 15)),
      h("button", { type: "button", class: "icon-button", title: "Sort", "aria-label": "Sort files", onclick: (event: MouseEvent) => this.sortMenu(event.currentTarget as HTMLElement) }, icon(icons.more, 15)));
    this.openList = h("div", { class: "open-docs" });
    this.treeElement = h("div", { class: "file-tree", role: "tree" });
    onContextMenu(this.treeElement, (x, y) => { if (!this.treeContextTarget) this.showEntryMenu(null, x, y); this.treeContextTarget = null; });
    const filesPane = h("section", { class: "sidebar-pane pane-files" },
      h("div", { class: "pane-header" }, this.workspaceButton, fileActions), this.openList, this.treeElement);

    // Outline pane
    this.outlineElement = h("nav", { class: "outline", "aria-label": "Outline" });
    const outlinePane = h("section", { class: "sidebar-pane pane-outline" }, this.outlineElement);

    // Search pane
    this.searchInput = h("input", { type: "search", class: "text-input search-input", placeholder: "Search in files", autocapitalize: "off", autocomplete: "off", spellcheck: false });
    this.searchInput.addEventListener("input", () => this.scheduleSearch());
    this.searchInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void this.search(); } });
    const toggle = (label: string, title: string, key: "searchCase" | "searchWord" | "searchRegex") => {
      const button = h("button", { type: "button", class: "search-option", title, "aria-pressed": "false" }, label);
      button.addEventListener("click", () => { this[key] = !this[key]; button.setAttribute("aria-pressed", String(this[key])); this.scheduleSearch(); });
      return button;
    };
    this.searchResults = h("div", { class: "search-results" });
    const searchPane = h("section", { class: "sidebar-pane pane-search" },
      h("div", { class: "search-box" }, this.searchInput,
        h("div", { class: "search-options" }, toggle("Aa", "Match case", "searchCase"), toggle("W", "Whole word", "searchWord"), toggle(".*", "Regular expression", "searchRegex"))),
      this.searchResults);

    this.panes.set("files", filesPane).set("outline", outlinePane).set("search", searchPane);
    this.element = h("aside", { class: "sidebar", "aria-label": "Sidebar" }, tabBar, filesPane, outlinePane, searchPane,
      h("div", { class: "sidebar-resizer", title: "Drag to resize" }));
    this.setupResizer(this.element.querySelector(".sidebar-resizer")!);
    this.loadExpanded();
  }

  private treeContextTarget: Entry | null = null;

  /* ---------- Tabs ---------- */

  setTab(tab: Tab) {
    this.tab = tab;
    for (const [id, button] of this.tabs) { button.classList.toggle("active", id === tab); button.setAttribute("aria-selected", String(id === tab)); }
    for (const [id, pane] of this.panes) pane.hidden = id !== tab;
    this.refresh();
  }

  focusSearch() {
    requestAnimationFrame(() => {
      const selection = this.app.view.state.selection.main;
      if (!selection.empty && selection.to - selection.from < 200) {
        this.searchInput.value = this.app.view.state.sliceDoc(selection.from, selection.to);
        this.scheduleSearch();
      }
      this.searchInput.focus();
      this.searchInput.select();
    });
  }

  refresh() {
    if (!this.app.sidebarOpen?.()) return;
    if (this.tab === "files") void this.renderFiles();
    else if (this.tab === "outline") this.refreshOutline();
  }

  refreshSoon() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refresh(), 250);
  }

  async setWorkspace(workspace: Workspace) {
    if (this.workspace.id !== workspace.id) { this.selectedDir = null; this.tree = null; }
    this.workspace = workspace;
    this.loadExpanded();
    this.updateWorkspaceButton();
    if (this.tab === "files") await this.renderFiles();
  }

  selectedDirectory(): string {
    if (this.selectedDir !== null) return this.selectedDir;
    const doc = this.app.doc;
    if (doc?.location.kind === "workspace" && doc.location.workspaceId === this.workspace.id) return dirname(doc.location.path);
    return "";
  }

  /* ---------- Files ---------- */

  private updateWorkspaceButton() {
    const glyph = this.workspace.kind === "library" ? icons.file : icons.folderOpen;
    this.workspaceButton.replaceChildren(icon(glyph, 15), h("span", { class: "workspace-name" }, this.workspace.name), icon(icons.chevron, 12));
  }

  private workspaceMenu() {
    const items: MenuItem[] = [];
    for (const workspace of this.app.docs.workspaces.values()) {
      items.push({
        label: workspace.kind === "library" ? "Library (on this device)" : workspace.name,
        checked: workspace.id === this.workspace.id,
        run: () => void this.app.switchWorkspace(workspace.id),
      });
    }
    items.push({ separator: true });
    items.push({ label: folderAccessSupported ? "Open Folder…" : "Open Folder… (not available in this browser)", disabled: !folderAccessSupported, run: () => this.app.run("file.openFolder") });
    const folders = [...this.app.docs.workspaces.values()].filter(workspace => workspace instanceof FolderWorkspace);
    if (folders.length) items.push({ label: "Forget Folder", submenu: folders.map(folder => ({ label: folder.name, run: () => void this.app.forgetWorkspace(folder.id) })) });
    items.push({ separator: true }, { label: "Where Are My Files?", run: () => this.app.run("help.storage") });
    showMenu(items, this.workspaceButton);
  }

  private sortMenu(anchor: HTMLElement) {
    const set = (value: Preferences["fileSort"]) => () => { this.app.prefs.fileSort = value; this.app.savePrefs(); void this.renderFiles(); };
    const sort = this.app.prefs.fileSort;
    showMenu([
      { label: "Sort by Name", checked: sort === "name", run: set("name") },
      { label: "Sort by Modified Date", checked: sort === "modified", run: set("modified") },
      { label: "Sort by Created Date", checked: sort === "created", run: set("created") },
      { separator: true },
      { label: "Collapse All Folders", run: () => { this.expanded.clear(); this.saveExpanded(); void this.renderFiles(); } },
    ], anchor, { align: "right" });
  }

  private expandedKey() { return `typorium.expanded.${this.workspace.id}`; }
  private loadExpanded() {
    try { this.expanded = new Set(JSON.parse(localStorage.getItem(this.expandedKey()) || "[]") as string[]); } catch { this.expanded = new Set(); }
  }
  private saveExpanded() {
    try { localStorage.setItem(this.expandedKey(), JSON.stringify([...this.expanded])); } catch { /* ignore */ }
  }

  private sortChildren(children: Entry[]) {
    const mode = this.app.prefs.fileSort;
    return [...children].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      if (mode === "modified" && a.kind === "file") return (b.mtime ?? 0) - (a.mtime ?? 0);
      if (mode === "created" && a.kind === "file") return (b.ctime ?? b.mtime ?? 0) - (a.ctime ?? a.mtime ?? 0);
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });
  }

  private rendering = false;
  async renderFiles() {
    this.updateWorkspaceButton();
    this.renderOpenDocs();
    if (this.rendering) { this.refreshSoon(); return; }
    this.rendering = true;
    try {
      this.tree = await this.workspace.tree();
    } catch (error) {
      this.treeElement.replaceChildren(h("div", { class: "pane-empty" }, h("p", null, "This folder can't be read right now."),
        h("button", { type: "button", class: "button", onclick: () => void this.app.grantPermissions() }, "Allow Access")));
      console.warn(error);
      return;
    } finally { this.rendering = false; }
    const list = h("ul", { class: "tree-list", role: "group" });
    this.renderEntries(this.tree, list, 0);
    if (!list.childElementCount) {
      this.treeElement.replaceChildren(h("div", { class: "pane-empty" },
        h("p", null, this.workspace.kind === "library" ? "Your Library is empty." : "No Markdown files in this folder."),
        h("button", { type: "button", class: "button", onclick: () => void this.app.newFileIn(this.workspace.id, "") }, "New File")));
      return;
    }
    this.treeElement.replaceChildren(list);
    this.markActive();
  }

  private renderEntries(directory: Entry, list: HTMLElement, depth: number) {
    for (const entry of this.sortChildren(directory.children ?? [])) {
      if (entry.kind === "file" && !isMarkdown(entry.path)) continue;
      if (entry.kind === "directory" && entry.name.startsWith(".")) continue;
      const isDir = entry.kind === "directory";
      const open = isDir && this.expanded.has(entry.path);
      const row = h("div", {
        class: `tree-row${isDir ? " tree-dir" : " tree-file"}${this.selectedDir === entry.path && isDir ? " selected" : ""}`,
        style: { paddingLeft: `${8 + depth * 14}px` }, dataset: { path: entry.path, kind: entry.kind }, tabindex: "0",
        title: entry.path,
      },
      isDir ? h("span", { class: `tree-twisty${open ? " open" : ""}` }, icon(icons.chevron, 12)) : h("span", { class: "tree-twisty" }),
      icon(isDir ? (open ? icons.folderOpen : icons.folder) : icons.file, 15),
      h("span", { class: "tree-name" }, isDir ? entry.name : entry.name.replace(/\.(md|markdown|mdown|mkd)$/i, "")),
      isTouch ? h("button", { type: "button", class: "tree-more icon-button", "aria-label": "More", onclick: (event: MouseEvent) => { event.stopPropagation(); const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); this.showEntryMenu(entry, rect.left, rect.bottom); } }, icon(icons.more, 14)) : null);
      row.addEventListener("click", () => this.activateEntry(entry));
      row.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.activateEntry(entry); }
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const rows = [...this.treeElement.querySelectorAll<HTMLElement>(".tree-row")];
          rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
        } else if (event.key === "ArrowRight" && isDir && !open) this.activateEntry(entry);
        else if (event.key === "ArrowLeft" && isDir && open) this.activateEntry(entry);
        else if (event.key === "F2") void this.app.renamePath(this.workspace.id, entry.path);
        else if (event.key === "Delete" || (event.key === "Backspace" && event.metaKey)) void this.app.deletePath(this.workspace.id, entry.path, isDir);
      });
      onContextMenu(row, (x, y) => { this.treeContextTarget = entry; this.showEntryMenu(entry, x, y); });
      this.setupDrag(row, entry);
      const item = h("li", { role: "treeitem", "aria-expanded": isDir ? String(open) : undefined }, row);
      if (open) {
        const children = h("ul", { class: "tree-list", role: "group" });
        this.renderEntries(entry, children, depth + 1);
        item.append(children);
      }
      list.append(item);
    }
  }

  private activateEntry(entry: Entry) {
    if (entry.kind === "directory") {
      if (this.expanded.has(entry.path)) this.expanded.delete(entry.path); else this.expanded.add(entry.path);
      this.selectedDir = entry.path;
      this.saveExpanded();
      void this.renderFiles().then(() => this.treeElement.querySelector<HTMLElement>(`.tree-row[data-path="${CSS.escape(entry.path)}"]`)?.focus({ preventScroll: true }));
    } else {
      this.selectedDir = null;
      void this.app.openWorkspaceFile(this.workspace.id, entry.path).catch(error => this.app.error(error));
    }
  }

  private showEntryMenu(entry: Entry | null, x: number, y: number) {
    const ws = this.workspace.id;
    const directory = entry ? (entry.kind === "directory" ? entry.path : dirname(entry.path)) : "";
    const items: MenuItem[] = [
      { label: "New File", run: () => void this.app.newFileIn(ws, directory) },
      { label: "New Folder", run: () => void this.app.newFolderIn(ws, directory) },
    ];
    if (entry) {
      items.push({ separator: true });
      if (entry.kind === "file") items.push({ label: "Open", run: () => this.activateEntry(entry) }, { label: "Duplicate", run: () => void this.app.duplicatePath(ws, entry.path) });
      items.push(
        { label: "Rename…", run: () => void this.app.renamePath(ws, entry.path) },
        { label: "Delete…", danger: true, run: () => void this.app.deletePath(ws, entry.path, entry.kind === "directory") },
      );
      if (entry.kind === "file") items.push({ separator: true }, { label: "Copy Path", run: () => void navigator.clipboard?.writeText(entry.path) });
    }
    items.push({ separator: true }, { label: "Refresh", run: () => this.refresh() });
    showMenu(items, { x, y });
  }

  /** Drag files onto folders to move them (desktop). */
  private setupDrag(row: HTMLElement, entry: Entry) {
    if (isTouch && !matchMedia("(pointer: fine)").matches) return;
    row.draggable = true;
    row.addEventListener("dragstart", event => { event.dataTransfer?.setData("application/x-typorium-path", entry.path); event.dataTransfer!.effectAllowed = "move"; });
    if (entry.kind !== "directory") return;
    row.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("application/x-typorium-path")) { event.preventDefault(); row.classList.add("drop-target"); } });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", event => {
      row.classList.remove("drop-target");
      const from = event.dataTransfer?.getData("application/x-typorium-path");
      if (!from || from === entry.path || entry.path.startsWith(from + "/")) return;
      event.preventDefault();
      const to = (entry.path ? entry.path + "/" : "") + from.split("/").pop();
      void (async () => {
        if (await this.workspace.exists(to)) { this.app.error(new Error(`“${to}” already exists.`)); return; }
        for (const doc of this.app.docs.docs) if (doc.location.kind === "workspace" && doc.location.path === from && this.app.docs.isDirty(doc)) await this.app.save(doc);
        await this.workspace.rename(from, to);
        this.app.docs.renamed(this.workspace.id, from, to);
        this.expanded.add(entry.path);
        this.saveExpanded();
        this.app.updateTitle();
        this.refresh();
      })().catch(error => this.app.error(error));
    });
  }

  /** Documents open outside this workspace (other folders, single files, untitled). */
  private renderOpenDocs() {
    const outside = this.app.docs.docs.filter(doc => !(doc.location.kind === "workspace" && doc.location.workspaceId === this.workspace.id));
    if (!outside.length) { this.openList.replaceChildren(); this.openList.hidden = true; return; }
    this.openList.hidden = false;
    const rows = outside.map(doc => {
      const dirty = this.app.docs.isDirty(doc);
      const row = h("div", { class: `tree-row open-doc${doc === this.app.doc ? " active" : ""}`, tabindex: "0", title: doc.location.kind === "handle" ? "File on disk" : doc.location.kind === "untitled" ? "Not saved yet" : doc.name },
        h("span", { class: "tree-twisty" }), icon(icons.file, 15), h("span", { class: "tree-name" }, doc.name), dirty ? h("span", { class: "dirty-dot" }, "•") : null,
        h("button", { type: "button", class: "icon-button tree-close", "aria-label": `Close ${doc.name}`, onclick: (event: MouseEvent) => { event.stopPropagation(); void this.app.closeDocument(doc); } }, icon(icons.close, 12)));
      row.addEventListener("click", () => void this.app.activate(doc));
      row.addEventListener("keydown", event => { if (event.key === "Enter") void this.app.activate(doc); });
      return row;
    });
    this.openList.replaceChildren(h("div", { class: "pane-subtitle" }, "Open Documents"), ...rows);
  }

  markActive() {
    const doc = this.app.doc;
    const path = doc?.location.kind === "workspace" && doc.location.workspaceId === this.workspace.id ? doc.location.path : null;
    for (const row of this.treeElement.querySelectorAll<HTMLElement>(".tree-file")) {
      const active = row.dataset.path === path;
      row.classList.toggle("active", active);
      const dirty = active && doc && this.app.docs.isDirty(doc);
      const dot = row.querySelector(".dirty-dot");
      if (dirty && !dot) row.querySelector(".tree-name")!.after(h("span", { class: "dirty-dot" }, "•"));
      else if (!dirty && dot) dot.remove();
    }
    if (this.tab === "files") this.renderOpenDocs();
  }

  /** Expand the folders containing the active document and scroll to it. */
  reveal() {
    const doc = this.app.doc;
    if (doc?.location.kind !== "workspace") return;
    if (doc.location.workspaceId !== this.workspace.id) { void this.app.switchWorkspace(doc.location.workspaceId).then(() => this.reveal()); return; }
    let dir = dirname(doc.location.path);
    while (dir) { this.expanded.add(dir); dir = dirname(dir); }
    this.saveExpanded();
    const path = doc.location.path;
    void this.renderFiles().then(() => {
      const row = this.treeElement.querySelector<HTMLElement>(`.tree-row[data-path="${CSS.escape(path)}"]`);
      row?.scrollIntoView({ block: "center" });
      row?.classList.add("flash");
      setTimeout(() => row?.classList.remove("flash"), 900);
    });
  }

  /* ---------- Outline ---------- */

  refreshOutline() {
    if (this.tab !== "outline" || !this.app.sidebarOpen()) return;
    const headings = collectHeadings(this.app.view.state);
    if (!headings.length) {
      this.outlineElement.replaceChildren(h("div", { class: "pane-empty" }, h("p", null, "Headings in this document appear here.")));
      return;
    }
    const minLevel = Math.min(...headings.map(entry => entry.level));
    const root = h("ul", { class: "outline-list" });
    const stack: { level: number; list: HTMLElement }[] = [{ level: minLevel - 1, list: root }];
    headings.forEach((entry, index) => {
      while (stack.length > 1 && stack[stack.length - 1].level >= entry.level) stack.pop();
      const hasChildren = headings[index + 1] && headings[index + 1].level > entry.level;
      const collapsed = this.collapsedOutline.has(entry.pos) && hasChildren;
      const twisty = h("span", { class: `tree-twisty${hasChildren ? "" : " empty"}${hasChildren && !collapsed ? " open" : ""}` }, hasChildren ? icon(icons.chevron, 11) : null);
      const row = h("div", { class: "outline-row", dataset: { pos: String(entry.pos) }, style: { paddingLeft: `${6 + (entry.level - minLevel) * 14}px` }, tabindex: "0", title: entry.text },
        twisty, h("span", { class: `outline-text outline-h${entry.level}` }, entry.text || "(empty heading)"));
      twisty.addEventListener("click", event => {
        event.stopPropagation();
        if (this.collapsedOutline.has(entry.pos)) this.collapsedOutline.delete(entry.pos); else this.collapsedOutline.add(entry.pos);
        this.refreshOutline();
      });
      row.addEventListener("click", () => this.jumpTo(entry.pos));
      row.addEventListener("keydown", event => { if (event.key === "Enter") this.jumpTo(entry.pos); });
      const item = h("li", null, row);
      stack[stack.length - 1].list.append(item);
      const nested = h("ul", { class: "outline-list", hidden: collapsed || undefined });
      item.append(nested);
      stack.push({ level: entry.level, list: nested });
    });
    this.outlineElement.replaceChildren(root);
    this.highlightOutline();
  }

  private jumpTo(pos: number) {
    const view = this.app.view;
    if (pos > view.state.doc.length) return;
    const line = view.state.doc.lineAt(pos);
    view.dispatch({ selection: EditorSelection.cursor(line.to), effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }) });
    if (window.innerWidth <= 760) this.app.setSidebar(false, false);
    view.focus();
  }

  highlightOutline() {
    if (this.tab !== "outline" || !this.app.sidebarOpen()) return;
    const head = this.app.view.state.selection.main.head;
    let current: HTMLElement | null = null;
    for (const row of this.outlineElement.querySelectorAll<HTMLElement>(".outline-row")) {
      row.classList.remove("active");
      if (Number(row.dataset.pos) <= head) current = row;
    }
    current?.classList.add("active");
  }

  /* ---------- Search ---------- */

  private scheduleSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => void this.search(), 250);
  }

  private matcher(query: string): RegExp | null {
    try {
      let source = this.searchRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (this.searchWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
      return new RegExp(source, `gu${this.searchCase ? "" : "i"}`);
    } catch { return null; }
  }

  async search() {
    const query = this.searchInput.value;
    const token = ++this.searchToken;
    if (!query.trim()) { this.searchResults.replaceChildren(); return; }
    const pattern = this.matcher(query);
    if (!pattern) { this.searchResults.replaceChildren(h("div", { class: "pane-empty" }, "Invalid regular expression.")); return; }
    this.searchResults.replaceChildren(h("div", { class: "pane-note" }, "Searching…"));
    const files: Entry[] = [];
    try {
      const walk = (entry: Entry) => { for (const child of entry.children ?? []) { if (child.kind === "directory") walk(child); else if (isMarkdown(child.path)) files.push(child); } };
      walk(await this.workspace.tree());
    } catch (error) { this.app.error(error); return; }
    const groups: HTMLElement[] = [];
    let total = 0;
    for (const file of files) {
      if (token !== this.searchToken) return;
      const open = this.app.docs.docs.find(doc => doc.location.kind === "workspace" && doc.location.workspaceId === this.workspace.id && doc.location.path === file.path);
      let text: string;
      try { text = open ? (open === this.app.doc ? this.app.view.state.doc.toString() : open.text) : (await this.workspace.readText(file.path)).replace(/\r\n?/g, "\n"); } catch { continue; }
      const hits: SearchHit[] = [];
      const nameMatch = pattern.test(file.name);
      pattern.lastIndex = 0;
      let lineStart = 0;
      const lines = text.split("\n");
      for (let index = 0; index < lines.length && hits.length < 50; index++) {
        const line = lines[index];
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) && hits.length < 50) {
          if (!match[0].length) { pattern.lastIndex++; continue; }
          hits.push({ path: file.path, name: file.name, line: index + 1, text: line, from: match.index, to: match.index + match[0].length, offset: lineStart + match.index });
        }
        lineStart += line.length + 1;
      }
      if (!hits.length && !nameMatch) continue;
      total += hits.length;
      const header = h("div", { class: "search-file", title: file.path, onclick: () => void this.app.openWorkspaceFile(this.workspace.id, file.path) },
        icon(icons.file, 14), h("span", { class: "tree-name" }, file.name), h("span", { class: "search-count" }, String(hits.length)));
      const list = h("div", { class: "search-hits" }, ...hits.map(hit => {
        const start = Math.max(0, hit.from - 30);
        const snippet = h("div", { class: "search-hit", tabindex: "0", title: `Line ${hit.line}` },
          start > 0 ? "…" : "", hit.text.slice(start, hit.from), h("mark", null, hit.text.slice(hit.from, hit.to)), hit.text.slice(hit.to, hit.to + 80));
        const go = () => void this.openHit(hit);
        snippet.addEventListener("click", go);
        snippet.addEventListener("keydown", event => { if (event.key === "Enter") go(); });
        return snippet;
      }));
      groups.push(h("div", { class: "search-group" }, header, list));
    }
    if (token !== this.searchToken) return;
    this.searchResults.replaceChildren(
      h("div", { class: "pane-note" }, groups.length ? `${total} result${total === 1 ? "" : "s"} in ${groups.length} file${groups.length === 1 ? "" : "s"}` : "No results."),
      ...groups);
  }

  private async openHit(hit: SearchHit) {
    await this.app.openWorkspaceFile(this.workspace.id, hit.path);
    const view = this.app.view;
    const from = Math.min(hit.offset, view.state.doc.length);
    const to = Math.min(from + (hit.to - hit.from), view.state.doc.length);
    view.dispatch({ selection: EditorSelection.range(from, to), effects: EditorView.scrollIntoView(from, { y: "center" }) });
    if (window.innerWidth <= 760) this.app.setSidebar(false, false);
    view.focus();
  }

  /* ---------- Resizing ---------- */

  private setupResizer(handle: HTMLElement) {
    const saved = Number(localStorage.getItem("typorium.sidebarWidth"));
    if (saved >= 180 && saved <= 600) document.documentElement.style.setProperty("--sidebar-width", `${saved}px`);
    handle.addEventListener("pointerdown", event => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const left = this.element.getBoundingClientRect().left;
      const move = (e: PointerEvent) => {
        const width = Math.min(600, Math.max(180, e.clientX - left));
        document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        const width = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width"));
        try { localStorage.setItem("typorium.sidebarWidth", String(width)); } catch { /* ignore */ }
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up, { once: true });
    });
  }
}
