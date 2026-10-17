// Formatting toolbar for touch devices (iPad, phones, touch laptops). Typora
// relies on a keyboard and menus; on a tablet that leaves formatting hidden, so
// this bar sits above the on-screen keyboard. It also keeps the app sized to
// the visual viewport, so the keyboard never covers the caret.
import { syntaxTree } from "@codemirror/language";
import type { App } from "./app";
import { h, icon, icons } from "./dom";
import { showMenu } from "./ui";
import { isTouch, isIOS } from "./platform";

interface Tool { id: string; title: string; glyph?: string; text?: string; run: () => void; active?: () => boolean; kind?: string }

export class FormatBar {
  element: HTMLElement;
  private buttons: { tool: Tool; button: HTMLButtonElement }[] = [];
  private keyboardOpen = false;

  constructor(private app: App) {
    const run = (id: string) => () => app.run(id);
    const tools: (Tool | "-")[] = [
      { id: "undo", title: "Undo", glyph: icons.undo, run: run("edit.undo") },
      { id: "redo", title: "Redo", glyph: icons.redo, run: run("edit.redo") },
      "-",
      { id: "heading", title: "Heading", glyph: icons.heading, run: () => this.headingMenu(), kind: "heading" },
      { id: "bold", title: "Bold", glyph: icons.bold, run: run("fmt.strong"), active: () => this.inNode("StrongEmphasis") },
      { id: "italic", title: "Italic", glyph: icons.italic, run: run("fmt.emphasis"), active: () => this.inNode("Emphasis") },
      { id: "strike", title: "Strikethrough", glyph: icons.strike, run: run("fmt.strike"), active: () => this.inNode("Strikethrough") },
      { id: "highlight", title: "Highlight", glyph: icons.highlight, run: run("fmt.highlight"), active: () => this.inNode("Highlight") },
      { id: "code", title: "Inline code", glyph: icons.code, run: run("fmt.code"), active: () => this.inNode("InlineCode") },
      { id: "link", title: "Link", glyph: icons.link, run: run("fmt.link"), active: () => this.inNode("Link") },
      "-",
      { id: "ul", title: "Bulleted list", glyph: icons.list, run: run("para.bulletList"), active: () => app.blockKind() === "ul" },
      { id: "ol", title: "Numbered list", glyph: icons.olist, run: run("para.orderedList"), active: () => app.blockKind() === "ol" },
      { id: "task", title: "Task list", glyph: icons.task, run: run("para.taskList"), active: () => app.blockKind() === "task" },
      { id: "outdent", title: "Outdent", glyph: icons.outdent, run: run("para.outdent") },
      { id: "indent", title: "Indent", glyph: icons.indent, run: run("para.indent") },
      { id: "quote", title: "Quote", glyph: icons.quote, run: run("para.quote"), active: () => app.blockKind() === "quote" },
      "-",
      { id: "table", title: "Table", glyph: icons.table, run: run("para.table") },
      { id: "fence", title: "Code block", text: "{ }", run: run("para.code") },
      { id: "math", title: "Math block", glyph: icons.math, run: run("para.math") },
      { id: "image", title: "Image", glyph: icons.image, run: run("fmt.image") },
      { id: "more", title: "More", glyph: icons.more, run: () => this.moreMenu() },
      "-",
      { id: "keyboard", title: "Hide keyboard", glyph: icons.keyboard, run: () => (document.activeElement as HTMLElement | null)?.blur(), kind: "keyboard" },
    ];
    const scroller = h("div", { class: "formatbar-scroll", role: "toolbar", "aria-label": "Formatting" });
    for (const tool of tools) {
      if (tool === "-") { scroller.append(h("span", { class: "formatbar-sep" })); continue; }
      const button = h("button", { type: "button", class: `formatbar-button fb-${tool.id}`, title: tool.title, "aria-label": tool.title, tabindex: "-1" },
        tool.glyph ? icon(tool.glyph, 18) : h("span", { class: "formatbar-text" }, tool.text ?? ""));
      // Keep focus (and the on-screen keyboard) in the editor.
      button.addEventListener("pointerdown", event => event.preventDefault());
      button.addEventListener("mousedown", event => event.preventDefault());
      button.addEventListener("click", () => { tool.run(); this.updateState(); });
      this.buttons.push({ tool, button });
      scroller.append(button);
    }
    this.element = h("div", { class: "formatbar", hidden: true }, scroller);
    this.trackViewport();
    app.view.contentDOM.addEventListener("focus", () => this.update());
    app.view.contentDOM.addEventListener("blur", () => setTimeout(() => this.update(), 50));
  }

  get visible() {
    const mode = this.app.prefs.showFormatBar;
    return mode === "always" || (mode === "auto" && isTouch);
  }

  update() {
    const show = this.visible && (this.app.prefs.showFormatBar === "always" || this.app.view.hasFocus || this.keyboardOpen);
    this.element.hidden = !show;
    this.app.root.classList.toggle("formatbar-visible", show);
    if (show) this.updateState();
  }

  updateState() {
    if (this.element.hidden) return;
    for (const { tool, button } of this.buttons) {
      if (!tool.active) continue;
      const active = tool.active();
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    const heading = this.buttons.find(item => item.tool.kind === "heading")?.button;
    const kind = this.app.blockKind();
    if (heading) heading.classList.toggle("active", /^h\d$/.test(kind));
  }

  private inNode(name: string) {
    const state = this.app.view.state;
    const pos = state.selection.main.head;
    for (const side of [-1, 1] as const) {
      for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, side); node; node = node.parent) {
        if (node.name === name) return true;
      }
    }
    return false;
  }

  private anchor(id: string) { return this.buttons.find(item => item.tool.id === id)!.button; }

  private headingMenu() {
    const kind = this.app.blockKind();
    showMenu([
      ...[1, 2, 3, 4, 5, 6].map(level => ({ label: `Heading ${level}`, checked: kind === `h${level}`, run: () => this.app.run(`para.h${level}`) })),
      { separator: true },
      { label: "Paragraph", checked: kind === "p", run: () => this.app.run("para.paragraph") },
    ], this.anchor("heading"), { className: "formatbar-menu" });
  }

  private moreMenu() {
    const items = this.app.menuItems([
      "fmt.underline", "fmt.superscript", "fmt.subscript", "fmt.inlineMath", "fmt.comment", "fmt.clear", "-",
      "para.hr", "para.footnote", "para.toc", "para.yaml", "-", "edit.emoji", "edit.find", "-", "view.source",
    ]);
    showMenu(items, this.anchor("more"), { className: "formatbar-menu", align: "right" });
  }

  /**
   * Size the app to the visual viewport. With the on-screen keyboard up, iOS
   * keeps the layout viewport full height and pans the page instead, which
   * would push the title bar off screen and hide the caret behind the keyboard.
   */
  private trackViewport() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    let lastHeight = 0;
    const apply = () => {
      frame = 0;
      const height = viewport.height;
      const resized = Math.abs(height - lastHeight) > 1;
      lastHeight = height;
      const keyboard = window.innerHeight - height - viewport.offsetTop;
      this.keyboardOpen = isTouch && keyboard > 120;
      root.style.setProperty("--app-height", `${Math.round(height)}px`);
      this.app.root.classList.toggle("keyboard-open", this.keyboardOpen);
      if (isIOS && viewport.offsetTop > 0 && this.keyboardOpen) window.scrollTo(0, 0);
      this.update();
      if (resized && this.app.view.hasFocus) this.app.view.dispatch({ scrollIntoView: true });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    apply();
  }
}
