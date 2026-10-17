// Quick Open (files) and the Command Palette, sharing one fuzzy-filtered list.
import type { App } from "./app";
import { h, icon, icons } from "./dom";
import { shortcutLabel } from "./platform";
import { isMarkdown, basename, dirname } from "../storage/paths";
import type { Entry } from "../storage/workspace";

interface PaletteItem { label: string; detail?: string; hint?: string; glyph?: string; run: () => unknown }

/** Subsequence match; lower score is better. Returns null when it doesn't match. */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase(), t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return direct === 0 ? 0 : 1 + direct / 100;
  let score = 10, last = -1;
  for (const char of q) {
    if (char === " ") continue;
    const index = t.indexOf(char, last + 1);
    if (index < 0) return null;
    score += index - last - 1;
    last = index;
  }
  return score;
}

let current: { close(): void } | null = null;

function palette(placeholder: string, load: () => PaletteItem[] | Promise<PaletteItem[]>, initial = "") {
  current?.close();
  const input = h("input", { type: "text", class: "palette-input", placeholder, autocapitalize: "off", autocomplete: "off", spellcheck: false, value: initial, "aria-label": placeholder });
  const list = h("div", { class: "palette-list", role: "listbox" });
  const box = h("div", { class: "palette", role: "dialog", "aria-label": placeholder }, input, list);
  const backdrop = h("div", { class: "palette-backdrop" }, box);
  const previous = document.activeElement as HTMLElement | null;
  let items: PaletteItem[] = [];
  let shown: PaletteItem[] = [];
  let selected = 0;

  const close = (restore = true) => {
    backdrop.remove();
    if (current?.close === closer) current = null;
    if (restore) previous?.focus?.({ preventScroll: true });
  };
  const closer = () => close();
  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    close(true);
    try {
      const result = item.run();
      if (result instanceof Promise) result.catch(error => console.error(error));
    } catch (error) { console.error(error); }
  };
  const render = () => {
    const query = input.value.trim();
    shown = items
      .map(item => ({ item, score: fuzzyScore(query, item.label + (item.detail ? " " + item.detail : "")) }))
      .filter((entry): entry is { item: PaletteItem; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 200)
      .map(entry => entry.item);
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((item, index) => {
      const row = h("div", { class: `palette-item${index === selected ? " selected" : ""}`, role: "option", "aria-selected": String(index === selected) },
        item.glyph ? icon(item.glyph, 15) : null,
        h("span", { class: "palette-label" }, item.label),
        item.detail ? h("span", { class: "palette-detail" }, item.detail) : null,
        item.hint ? h("kbd", { class: "palette-hint" }, item.hint) : null);
      row.addEventListener("mousedown", event => event.preventDefault());
      row.addEventListener("click", () => choose(item));
      return row;
    }));
    if (!shown.length) list.append(h("div", { class: "palette-empty" }, items.length ? "No matches" : "Loading…"));
    list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  };
  input.addEventListener("input", () => { selected = 0; render(); });
  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") { event.preventDefault(); selected = Math.min(shown.length - 1, selected + 1); render(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); selected = Math.max(0, selected - 1); render(); }
    else if (event.key === "Enter") { event.preventDefault(); choose(shown[selected]); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  });
  backdrop.addEventListener("mousedown", event => { if (event.target === backdrop) close(); });
  document.body.append(backdrop);
  input.focus();
  input.select();
  current = { close: closer };
  render();
  void Promise.resolve(load()).then(loaded => { items = loaded; render(); });
}

export function quickOpen(app: App) {
  palette("Open a file by name", async () => {
    const items: PaletteItem[] = [];
    const seen = new Set<string>();
    for (const doc of app.docs.docs) {
      const key = doc.location.kind === "workspace" ? `${doc.location.workspaceId}:${doc.location.path}` : doc.id;
      seen.add(key);
      items.push({ label: doc.name, detail: doc === app.doc ? "current" : "open", glyph: icons.file, run: () => app.activate(doc) });
    }
    const workspace = app.workspace;
    try {
      const walk = (entry: Entry) => {
        for (const child of entry.children ?? []) {
          if (child.kind === "directory") walk(child);
          else if (isMarkdown(child.path) && !seen.has(`${workspace.id}:${child.path}`)) {
            seen.add(`${workspace.id}:${child.path}`);
            items.push({ label: basename(child.path), detail: dirname(child.path) || workspace.name, glyph: icons.file, run: () => app.openWorkspaceFile(workspace.id, child.path) });
          }
        }
      };
      walk(await workspace.tree());
    } catch { /* folder permission missing */ }
    for (const recent of app.recentList) {
      const key = `${recent.workspaceId}:${recent.path}`;
      if (recent.kind !== "file" || seen.has(key) || !app.docs.workspaces.has(recent.workspaceId)) continue;
      seen.add(key);
      items.push({ label: recent.name, detail: `recent · ${app.docs.workspaces.get(recent.workspaceId)!.name}`, glyph: icons.file, run: () => app.openWorkspaceFile(recent.workspaceId, recent.path) });
    }
    return items;
  });
}

export function commandPalette(app: App) {
  palette("Type a command", () => {
    const items: PaletteItem[] = [];
    const skip = new Set(["theme.list", "file.recent", "view.commandPalette"]);
    for (const command of app.commands.values()) {
      if (skip.has(command.id) || (command.enabled && !command.enabled())) continue;
      const group = command.id.split(".")[0];
      const prefix = { file: "File", export: "Export", edit: "Edit", para: "Paragraph", fmt: "Format", view: "View", theme: "Themes", app: "Typorium", help: "Help" }[group] ?? "";
      const checked = command.checked?.();
      items.push({ label: `${prefix}: ${command.label}${checked ? " ✓" : ""}`, hint: command.key ? shortcutLabel(command.key) : undefined, run: () => app.run(command.id) });
    }
    for (const theme of app.themes) items.push({ label: `Themes: ${theme.name}${app.prefs.theme === theme.id ? " ✓" : ""}`, run: () => app.setTheme(theme.id) });
    return items;
  });
}
