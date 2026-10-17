// Preferences dialog. Changes apply immediately, like Typora's preferences panel.
import type { App } from "./app";
import { h } from "./dom";
import { modal, confirmDialog, toast } from "./ui";
import { defaultPreferences, type Preferences } from "./prefs";

type Key = keyof Preferences;

export function openPreferences(app: App) {
  const p = app.prefs;
  const apply = () => { app.savePrefs(); app.applyPreferences(); };

  const checkbox = (key: Key, label: string, help?: string) => {
    const input = h("input", { type: "checkbox", checked: Boolean(p[key]) });
    input.addEventListener("change", () => { (p as unknown as Record<string, unknown>)[key] = input.checked; apply(); });
    return h("label", { class: "pref-row pref-check" }, input, h("span", null, label, help ? h("small", null, help) : null));
  };
  const select = <K extends Key>(key: K, label: string, options: [Preferences[K], string][], onChange?: (value: Preferences[K]) => void) => {
    const element = h("select", { class: "text-input" }, ...options.map(([value, text]) => h("option", { value: String(value), selected: p[key] === value }, text)));
    element.addEventListener("change", () => {
      const option = options.find(([value]) => String(value) === element.value);
      if (!option) return;
      if (onChange) onChange(option[0]); else { p[key] = option[0]; apply(); }
    });
    return h("label", { class: "pref-row" }, h("span", null, label), element);
  };
  const number = (key: Key, label: string, min: number, max: number, step: number, unit = "") => {
    const input = h("input", { type: "number", class: "text-input pref-number", min: String(min), max: String(max), step: String(step), value: String(p[key]) });
    input.addEventListener("change", () => {
      const value = Math.min(max, Math.max(min, Number(input.value) || Number(defaultPreferences[key])));
      input.value = String(value);
      (p as unknown as Record<string, unknown>)[key] = value;
      apply();
    });
    return h("label", { class: "pref-row" }, h("span", null, label), h("span", { class: "pref-input-unit" }, input, unit ? h("span", null, unit) : null));
  };
  const text = (key: "imageFolder", label: string, placeholder: string) => {
    const input = h("input", { type: "text", class: "text-input", value: p[key], placeholder, autocapitalize: "off", spellcheck: false });
    input.addEventListener("change", () => { p[key] = input.value.trim() || defaultPreferences[key]; apply(); });
    return h("label", { class: "pref-row" }, h("span", null, label), input);
  };

  const sections: [string, HTMLElement[]][] = [
    ["General", [
      checkbox("autoSave", "Save automatically", "Documents in the Library or an open folder are saved as you type."),
      checkbox("restoreSession", "Reopen documents from last time"),
      select("fileSort", "Sort files by", [["name", "Name"], ["modified", "Date modified"], ["created", "Date created"]]),
    ]],
    ["Editor", [
      number("fontSize", "Font size", 10, 32, 1, "px"),
      select("lineWidth", "Line width", [["narrow", "Narrow"], ["normal", "Normal"], ["wide", "Wide"], ["full", "Full width"]]),
      number("lineHeight", "Line height", 1, 2.5, 0.1),
      select("tabSize", "Indentation", [[2, "2 spaces"], [4, "4 spaces"]]),
      checkbox("spellcheck", "Check spelling"),
      checkbox("autoPairBrackets", "Auto pair brackets and quotes"),
      checkbox("autoPairMarkdown", "Auto pair Markdown symbols", "Wrap a selection in * _ ` ~ = $ when you type them."),
      select("showFormatBar", "Formatting toolbar", [["auto", "On touch devices"], ["always", "Always"], ["never", "Never"]]),
      checkbox("showStatusBar", "Show status bar"),
    ]],
    ["Appearance", [
      select("theme", "Theme", app.themes.map(theme => [theme.id, theme.name] as [string, string]), value => app.setTheme(value)),
      select("appearance", "Dark mode", [["auto", "Follow the system (use Night when dark)"], ["light", "Always use the selected theme"], ["dark", "Always dark"]], value => app.setAppearance(value)),
    ]],
    ["Images", [
      select("imageInsert", "When inserting an image", [
        ["assets", "Copy to ./assets"], ["filename-assets", "Copy to ./${filename}.assets"], ["custom", "Copy to a custom folder"], ["data-uri", "Embed in the document (data URI)"],
      ]),
      text("imageFolder", "Custom folder", "./images"),
      h("p", { class: "pref-note" }, "A document's own typora-copy-images-to front matter key takes precedence, as in Typora."),
    ]],
    ["Export", [
      checkbox("exportIncludeTheme", "Use the current theme for HTML and PDF"),
      select("pdfPageSize", "PDF page size", [["A4", "A4"], ["Letter", "US Letter"], ["Legal", "US Legal"], ["A5", "A5"]]),
      number("pdfMargin", "PDF margins", 0, 50, 1, "mm"),
      number("readingSpeed", "Reading speed", 50, 1000, 10, "words/min"),
    ]],
  ];

  const css = h("textarea", { class: "text-input pref-css", rows: 6, spellcheck: false, placeholder: "#write { font-family: Georgia, serif; }" }, p.customCss);
  css.addEventListener("input", () => { p.customCss = css.value; app.savePrefs(); app.applyThemePreference(); });
  sections.push(["Custom CSS", [h("p", { class: "pref-note" }, "Added after the theme, like Typora's base.user.css. Target #write for the document."), css]]);

  const nav = h("nav", { class: "prefs-nav" });
  const content = h("div", { class: "prefs-content" });
  for (const [title, rows] of sections) {
    const section = h("section", { class: "prefs-section" }, h("h3", null, title), ...rows);
    content.append(section);
    nav.append(h("button", { type: "button", class: "prefs-nav-item", onclick: () => section.scrollIntoView({ behavior: "smooth", block: "start" }) }, title));
  }
  const reset = h("button", { type: "button", class: "button button-danger", onclick: async () => {
    if (!(await confirmDialog("Reset preferences?", "All preferences go back to their defaults. Your documents aren't affected.", "Reset", true))) return;
    Object.assign(app.prefs, defaultPreferences);
    app.savePrefs();
    app.applyPreferences();
    toast("Preferences were reset. Reopen this dialog to see them.");
  } }, "Reset to Defaults");
  content.append(h("section", { class: "prefs-section" }, reset));

  void modal({ title: "Preferences", body: h("div", { class: "prefs" }, nav, content), className: "modal-wide modal-prefs", buttons: [{ label: "Done", value: "done", primary: true }] });
}
