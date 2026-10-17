// Dialogs, toasts and popup menus used across the app shell.
import { h, icon, icons } from "./dom";
import { shortcutLabel } from "./platform";

/* ---------- Toast ---------- */

let toastHost: HTMLElement | null = null;
export function toast(message: string, options: { kind?: "info" | "error" | "success"; timeout?: number; action?: { label: string; run: () => void } } = {}) {
  toastHost ??= document.body.appendChild(h("div", { class: "toast-host", role: "status", "aria-live": "polite" }));
  const element = h("div", { class: `toast toast-${options.kind ?? "info"}` }, h("span", null, message));
  if (options.action) {
    const action = options.action;
    element.append(h("button", { type: "button", class: "toast-action", onclick: () => { action.run(); element.remove(); } }, action.label));
  }
  toastHost.append(element);
  setTimeout(() => element.classList.add("toast-leave"), options.timeout ?? 3200);
  setTimeout(() => element.remove(), (options.timeout ?? 3200) + 300);
}

/* ---------- Modal dialog ---------- */

export interface DialogButton { label: string; value: string; primary?: boolean; danger?: boolean }

export function modal<T = string | null>(options: {
  title: string; body?: Node | string; buttons?: DialogButton[]; className?: string; dismissValue?: T;
  onOpen?(dialog: HTMLElement, close: (value: T) => void): void; resolveButton?(value: string): T | undefined;
}): Promise<T> {
  return new Promise(resolve => {
    const previous = document.activeElement as HTMLElement | null;
    const backdrop = h("div", { class: "modal-backdrop" });
    const dialog = h("div", { class: `modal ${options.className ?? ""}`, role: "dialog", "aria-modal": "true", "aria-label": options.title });
    let done = false;
    const close = (value: T) => {
      if (done) return;
      done = true;
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.({ preventScroll: true });
      resolve(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(options.dismissValue as T); }
    };
    const header = h("div", { class: "modal-header" }, h("h2", null, options.title),
      h("button", { type: "button", class: "icon-button modal-close", "aria-label": "Close", onclick: () => close(options.dismissValue as T) }, icon(icons.close)));
    const body = h("div", { class: "modal-body" });
    if (typeof options.body === "string") body.append(h("p", null, options.body)); else if (options.body) body.append(options.body);
    dialog.append(header, body);
    if (options.buttons?.length) {
      const footer = h("div", { class: "modal-footer" });
      for (const button of options.buttons) {
        footer.append(h("button", {
          type: "button", class: `button${button.primary ? " button-primary" : ""}${button.danger ? " button-danger" : ""}`,
          dataset: { value: button.value },
          onclick: () => close((options.resolveButton ? options.resolveButton(button.value) : button.value) as T),
        }, button.label));
      }
      dialog.append(footer);
    }
    backdrop.append(dialog);
    backdrop.addEventListener("mousedown", event => { if (event.target === backdrop) close(options.dismissValue as T); });
    document.body.append(backdrop);
    document.addEventListener("keydown", onKey, true);
    options.onOpen?.(dialog, close);
    const focusTarget = dialog.querySelector<HTMLElement>("[autofocus], input, select, textarea, .button-primary");
    focusTarget?.focus();
  });
}

export async function confirmDialog(title: string, message: string, confirmLabel = "OK", danger = false) {
  const result = await modal<string | null>({
    title, body: message, dismissValue: null,
    buttons: [{ label: "Cancel", value: "cancel" }, { label: confirmLabel, value: "ok", primary: !danger, danger }],
  });
  return result === "ok";
}

export async function choiceDialog(title: string, message: string, buttons: DialogButton[]) {
  return modal<string | null>({ title, body: message, buttons, dismissValue: null });
}

export function promptDialog(title: string, label: string, value = "", options: { placeholder?: string; selectStem?: boolean; confirmLabel?: string } = {}): Promise<string | null> {
  const input = h("input", { type: "text", class: "text-input", value, placeholder: options.placeholder ?? "", autocapitalize: "off", autocomplete: "off", spellcheck: false });
  const form = h("form", { class: "form-field" }, h("label", null, h("span", null, label), input));
  return modal<string | null>({
    title, body: form, dismissValue: null,
    buttons: [{ label: "Cancel", value: "\u0000cancel" }, { label: options.confirmLabel ?? "OK", value: "\u0000ok", primary: true }],
    resolveButton: v => v === "\u0000ok" ? input.value : null,
    onOpen(_dialog, close) {
      form.addEventListener("submit", event => { event.preventDefault(); close(input.value); });
      requestAnimationFrame(() => {
        input.focus();
        const dot = value.lastIndexOf(".");
        if (options.selectStem && dot > 0) input.setSelectionRange(0, dot); else input.select();
      });
    },
  });
}

/* ---------- Popup menus ---------- */

export interface MenuItem {
  label?: string;
  shortcut?: string;
  run?: () => void;
  checked?: boolean;
  disabled?: boolean;
  submenu?: MenuItem[] | (() => MenuItem[]);
  separator?: boolean;
  danger?: boolean;
}

let openMenu: { close: () => void } | null = null;

export function closeMenus() { openMenu?.close(); openMenu = null; }

export function showMenu(items: MenuItem[], anchor: { x: number; y: number } | HTMLElement, options: { className?: string; onClose?: () => void; align?: "left" | "right" } = {}) {
  closeMenus();
  const layers: HTMLElement[] = [];
  const close = () => {
    for (const layer of layers) layer.remove();
    layers.length = 0;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", keys, true);
    window.removeEventListener("blur", close);
    window.removeEventListener("resize", close);
    if (openMenu?.close === close) openMenu = null;
    options.onClose?.();
  };
  const outside = (event: Event) => {
    if (layers.some(layer => layer.contains(event.target as Node))) return;
    if (anchor instanceof HTMLElement && anchor.contains(event.target as Node)) return;
    close();
  };
  const build = (list: MenuItem[], depth: number, at: { x: number; y: number; alignRight?: boolean; parentRect?: DOMRect }) => {
    while (layers.length > depth) layers.pop()!.remove();
    const menu = h("div", { class: `popup-menu ${options.className ?? ""}`, role: "menu" });
    for (const item of list) {
      if (item.separator) { menu.append(h("div", { class: "menu-separator", role: "separator" })); continue; }
      const sub = typeof item.submenu === "function" ? item.submenu() : item.submenu;
      const row = h("button", {
        type: "button", role: item.checked !== undefined ? "menuitemcheckbox" : "menuitem",
        class: `menu-item${item.disabled ? " disabled" : ""}${item.danger ? " danger" : ""}${sub ? " has-submenu" : ""}`,
        "aria-checked": item.checked !== undefined ? String(item.checked) : undefined,
        disabled: item.disabled || undefined,
      },
      h("span", { class: "menu-check" }, item.checked ? "✓" : ""),
      h("span", { class: "menu-label" }, item.label ?? ""),
      h("span", { class: "menu-shortcut" }, sub ? "›" : shortcutLabel(item.shortcut)));
      row.addEventListener("mousedown", event => event.preventDefault());
      if (sub) {
        const open = () => {
          // Only the row whose submenu is showing stays highlighted.
          if (row.classList.contains("open") && layers.length > depth + 1) return;
          menu.querySelectorAll(".menu-item.open").forEach(el => el.classList.remove("open"));
          const rect = row.getBoundingClientRect();
          build(sub, depth + 1, { x: rect.right - 2, y: rect.top - 4, parentRect: rect });
          row.classList.add("open");
        };
        row.addEventListener("click", open);
        row.addEventListener("pointerenter", event => { if ((event as PointerEvent).pointerType === "mouse") open(); });
      } else {
        row.addEventListener("pointerenter", () => { while (layers.length > depth + 1) layers.pop()!.remove(); menu.querySelectorAll(".open").forEach(el => el.classList.remove("open")); });
        row.addEventListener("click", () => { if (item.disabled) return; closeMenus(); close(); item.run?.(); });
      }
      menu.append(row);
    }
    document.body.append(menu);
    layers.push(menu);
    // Keep the menu on screen.
    const rect = menu.getBoundingClientRect();
    const viewport = window.visualViewport;
    const vw = viewport?.width ?? window.innerWidth, vh = viewport?.height ?? window.innerHeight;
    let x = at.alignRight ? at.x - rect.width : at.x, y = at.y;
    if (x + rect.width > vw - 4) x = at.parentRect ? at.parentRect.left - rect.width + 2 : vw - rect.width - 4;
    if (y + rect.height > vh - 4) y = Math.max(4, vh - rect.height - 4);
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${Math.max(4, y)}px`;
    menu.style.maxHeight = `${vh - 8}px`;
    return menu;
  };
  const keys = (event: KeyboardEvent) => {
    const menu = layers[layers.length - 1];
    if (!menu) return;
    const rows = [...menu.querySelectorAll<HTMLButtonElement>(".menu-item:not(.disabled)")];
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (layers.length > 1) layers.pop()!.remove(); else close(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); rows[(index + 1) % rows.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); rows[(index - 1 + rows.length) % rows.length]?.focus(); }
    else if (event.key === "ArrowRight" && index >= 0 && rows[index].classList.contains("has-submenu")) { event.preventDefault(); rows[index].click(); layers[layers.length - 1]?.querySelector<HTMLElement>(".menu-item")?.focus(); }
    else if (event.key === "ArrowLeft" && layers.length > 1) { event.preventDefault(); layers.pop()!.remove(); }
  };
  let position: { x: number; y: number; alignRight?: boolean };
  if (anchor instanceof HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    position = options.align === "right" ? { x: rect.right, y: rect.bottom + 2, alignRight: true } : { x: rect.left, y: rect.bottom + 2 };
  } else position = anchor;
  build(items, 0, position);
  setTimeout(() => {
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
  });
  document.addEventListener("keydown", keys, true);
  openMenu = { close };
  return { close };
}

/* ---------- File pickers ---------- */

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise(resolve => {
    const input = h("input", { type: "file", accept, multiple, style: { display: "none" } });
    input.addEventListener("change", () => { resolve([...(input.files ?? [])]); input.remove(); });
    input.addEventListener("cancel", () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

/** Save a file: share sheet on iOS (so it can go to Files), download elsewhere. */
export async function saveBlob(blob: Blob, name: string, preferShare = false) {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?(data: ShareData): boolean };
  if (preferShare && nav.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (error) {
      if ((error as DOMException).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: name, style: { display: "none" } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
