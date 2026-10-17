// Widgets that stand in for Markdown syntax in live-preview mode.
import { WidgetType, EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { fillMath } from "../render/math";
import { fillDiagram, diagramGeneration } from "../render/diagrams";
import { sanitizeHtml, renderInline } from "../render/markdown";
import { editorHost } from "./state";

const bullets = ["•", "◦", "▪"];

export class BulletWidget extends WidgetType {
  constructor(readonly depth: number) { super(); }
  eq(other: BulletWidget) { return other.depth === this.depth; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "md-list-bullet";
    span.textContent = bullets[this.depth % bullets.length];
    span.setAttribute("aria-hidden", "true");
    return span;
  }
}

export class OrderedWidget extends WidgetType {
  constructor(readonly label: string) { super(); }
  eq(other: OrderedWidget) { return other.label === this.label; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "md-list-number";
    span.textContent = this.label;
    return span;
  }
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) { super(); }
  eq(other: CheckboxWidget) { return other.checked === this.checked && other.pos === this.pos; }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "md-task-checkbox";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Completed task" : "Task");
    box.addEventListener("mousedown", event => event.preventDefault());
    box.addEventListener("click", event => {
      event.preventDefault();
      const pos = view.posAtDOM(box);
      const text = view.state.sliceDoc(pos, pos + 3);
      if (!/^\[[ xX]\]$/.test(text)) return;
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? " " : "x" }, userEvent: "input.task" });
    });
    return box;
  }
  ignoreEvent() { return true; }
}

export class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const hr = document.createElement("hr");
    hr.className = "md-hr-widget";
    return hr;
  }
}

export class EmojiWidget extends WidgetType {
  constructor(readonly emoji: string, readonly name: string) { super(); }
  eq(other: EmojiWidget) { return other.emoji === this.emoji; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "md-emoji";
    span.textContent = this.emoji;
    span.title = `:${this.name}:`;
    return span;
  }
}

export class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly display: boolean, readonly preview = false) { super(); }
  eq(other: MathWidget) { return other.tex === this.tex && other.display === this.display && other.preview === this.preview; }
  toDOM() {
    const element = document.createElement(this.display ? "div" : "span");
    element.className = this.display ? "md-math-block" : "md-math-inline";
    if (this.preview) element.classList.add("md-math-preview");
    const inner = document.createElement(this.display ? "div" : "span");
    inner.className = "md-math-content";
    element.append(inner);
    if (!this.tex.trim()) {
      inner.textContent = this.display ? "Enter a TeX formula" : "";
      element.classList.add("md-math-empty");
    } else fillMath(inner, this.tex, this.display);
    return element;
  }
  get estimatedHeight() { return this.display ? 48 : -1; }
}

export class DiagramWidget extends WidgetType {
  readonly generation = diagramGeneration;
  constructor(readonly language: string, readonly source: string, readonly preview = false) { super(); }
  eq(other: DiagramWidget) { return other.language === this.language && other.source === this.source && other.preview === this.preview && other.generation === this.generation; }
  toDOM() {
    const element = document.createElement("div");
    element.className = "md-diagram";
    if (this.preview) element.classList.add("md-diagram-preview");
    if (!this.source.trim()) {
      element.textContent = "Empty diagram";
      element.classList.add("md-diagram-empty");
    } else fillDiagram(element, this.language, this.source);
    return element;
  }
  get estimatedHeight() { return 160; }
}

export class HtmlWidget extends WidgetType {
  constructor(readonly html: string) { super(); }
  eq(other: HtmlWidget) { return other.html === this.html; }
  toDOM() {
    const element = document.createElement("div");
    element.className = "md-htmlblock";
    element.innerHTML = sanitizeHtml(this.html);
    for (const link of element.querySelectorAll("a")) link.addEventListener("click", event => event.preventDefault());
    return element;
  }
}

export interface TocEntry { level: number; text: string; pos: number }

export class TocWidget extends WidgetType {
  constructor(readonly entries: TocEntry[]) { super(); }
  eq(other: TocWidget) { return JSON.stringify(other.entries) === JSON.stringify(this.entries); }
  toDOM(view: EditorView) {
    const element = document.createElement("div");
    element.className = "md-toc";
    const content = document.createElement("p");
    content.className = "md-toc-content";
    element.append(content);
    const min = Math.min(...this.entries.map(entry => entry.level), 6);
    if (!this.entries.length) content.textContent = "Table of contents (add headings to fill it)";
    for (const entry of this.entries) {
      const item = document.createElement("span");
      item.className = `md-toc-item md-toc-h${entry.level - min + 1}`;
      const link = document.createElement("a");
      link.className = "md-toc-inner";
      link.innerHTML = renderInline(entry.text);
      link.href = "#";
      link.addEventListener("mousedown", event => {
        event.preventDefault();
        event.stopPropagation();
        const line = view.state.doc.lineAt(Math.min(entry.pos, view.state.doc.length));
        view.dispatch({ selection: EditorSelection.cursor(line.to), effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 40 }) });
        view.focus();
      });
      item.append(link);
      content.append(item);
    }
    return element;
  }
}

export class FootnoteRefWidget extends WidgetType {
  constructor(readonly label: string, readonly definition: string, readonly index: number) { super(); }
  eq(other: FootnoteRefWidget) { return other.label === this.label && other.definition === this.definition && other.index === this.index; }
  toDOM() {
    const sup = document.createElement("sup");
    sup.className = "md-footnote";
    sup.textContent = String(this.index || this.label);
    sup.title = this.definition || `Footnote [^${this.label}] has no definition`;
    return sup;
  }
}

export class AlertLabelWidget extends WidgetType {
  constructor(readonly kind: string) { super(); }
  eq(other: AlertLabelWidget) { return other.kind === this.kind; }
  toDOM() {
    const span = document.createElement("span");
    span.className = `md-alert-text md-alert-text-${this.kind.toLowerCase()}`;
    span.textContent = this.kind[0] + this.kind.slice(1).toLowerCase();
    return span;
  }
}

export class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly title: string, readonly attrs: Record<string, string> = {}, readonly block = false) { super(); }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.title === this.title && other.block === this.block && JSON.stringify(other.attrs) === JSON.stringify(this.attrs);
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "md-image" + (this.block ? " md-image-block" : "");
    const img = document.createElement("img");
    img.alt = this.alt;
    if (this.title) img.title = this.title;
    for (const [name, value] of Object.entries(this.attrs)) {
      if (name === "style") img.setAttribute("style", value.replace(/url\s*\(|expression\s*\(/gi, ""));
      else if (["width", "height", "align"].includes(name)) img.setAttribute(name, value);
    }
    img.draggable = false;
    const fail = () => {
      wrap.classList.add("md-image-broken");
      img.remove();
      const label = document.createElement("span");
      label.className = "md-image-broken-label";
      label.textContent = `🖼 ${this.alt || this.src || "image"}`;
      label.title = this.src ? `Image not found: ${this.src}` : "Empty image path";
      wrap.append(label);
    };
    img.addEventListener("error", fail, { once: true });
    img.addEventListener("load", () => view.requestMeasure());
    wrap.append(img);
    if (!this.src) { fail(); return wrap; }
    const resolved = view.state.facet(editorHost).resolveImage(this.src);
    const apply = (url: string | null) => { if (url) img.src = url; else fail(); };
    if (resolved instanceof Promise) resolved.then(apply, () => fail());
    else apply(resolved);
    return wrap;
  }
  get estimatedHeight() { return this.block ? 200 : -1; }
}
