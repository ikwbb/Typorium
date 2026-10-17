// Shared editor state for live preview: focus tracking, "is the cursor inside
// this element" checks, and host hooks (image URLs, link opening).
import { EditorState, Facet, StateEffect, StateField, type EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export interface EditorHost {
  /** Resolve an image src from the document to something an <img> can load. */
  resolveImage(src: string): Promise<string | null> | string | null;
  /** Open a link (Mod+click or the link tooltip). */
  openLink(href: string, view: EditorView): void;
}

export const editorHost = Facet.define<EditorHost, EditorHost>({
  combine: values => values[0] ?? {
    resolveImage: src => src,
    openLink: href => window.open(href, "_blank", "noopener"),
  },
});

export const setFocused = StateEffect.define<boolean>();

export const focusField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFocused)) return effect.value;
    return value;
  },
});

export const focusTracking = [
  focusField,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
];

/** Forces live-preview decorations to rebuild (e.g. after images or settings change). */
export const refreshDecorations = StateEffect.define<null>();

export function touches(selection: EditorSelection, from: number, to: number) {
  for (const range of selection.ranges) if (range.from <= to && range.to >= from) return true;
  return false;
}

/** True when the element [from, to] should show its Markdown source. */
export function isActive(state: EditorState, from: number, to: number) {
  return state.field(focusField, false) !== false && touches(state.selection, from, to);
}

/** Line-range variant: active when the selection touches any of the lines. */
export function isLineActive(state: EditorState, from: number, to: number) {
  if (state.field(focusField, false) === false) return false;
  const start = state.doc.lineAt(from).from, end = state.doc.lineAt(to).to;
  return touches(state.selection, start, end);
}
