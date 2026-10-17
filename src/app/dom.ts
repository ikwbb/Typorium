// Minimal DOM builder.
type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string | Partial<CSSStyleDeclaration>; dataset?: Record<string, string> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props) for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") element.className = String(value);
    else if (key === "style" && typeof value === "object") Object.assign(element.style, value);
    else if (key === "dataset") Object.assign(element.dataset, value as Record<string, string>);
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key in element && typeof value !== "string") (element as unknown as Record<string, unknown>)[key] = value;
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) element.append(child);
  return element;
}

export const icon = (paths: string, size = 16) => {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return span;
};

export const icons = {
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  source: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderOpen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1H7.5a2 2 0 0 0-1.9 1.4L3 19z"/><path d="M3 19 5.6 11.4A2 2 0 0 1 7.5 10H21l-2.5 7.6A2 2 0 0 1 16.6 19z"/>',
  outline: '<path d="M4 6h16M7 12h13M10 18h10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M11 5h6M7 19h6M14 5l-4 14"/>',
  strike: '<path d="M5 12h14M16 7a4 3 0 0 0-4-2c-2.5 0-4 1.3-4 3 0 3.5 8 2.5 8 7 0 1.8-1.7 3-4 3a4.5 3 0 0 1-4.5-2"/>',
  code: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5L5 20"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  olist: '<path d="M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5c.5-.7 2.8-.9 2.8.7 0 1.3-2.8 2.1-2.8 3.8h3"/>',
  task: '<rect x="3.5" y="4.5" width="6" height="6" rx="1"/><path d="m4.8 7.6 1.4 1.4 2.4-2.6M13 7.5h7.5M3.5 14.5h6v6h-6zM13 17.5h7.5"/>',
  quote: '<path d="M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
  heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
  math: '<path d="M4 6h7l-4 6 4 6H4M14 9l6 6M20 9l-6 6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  highlight: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  hr: '<path d="M3 12h18"/>',
  indent: '<path d="M3 6h18M11 12h10M11 18h10M3 10l4 3-4 3"/>',
  outdent: '<path d="M3 6h18M11 12h10M11 18h10M7 10l-4 3 4 3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
};
