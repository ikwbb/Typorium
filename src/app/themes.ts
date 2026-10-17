// Themes use Typora's theme format: CSS that styles real elements under #write
// plus Typora's CSS variables. Built-in themes are written that way too. For the
// live editor (where blocks are CodeMirror lines with classes such as .md-h1),
// each theme is adapted: element selectors are mapped onto the line classes and
// margins become paddings, so imported Typora themes also restyle live editing.
import baseCss from "../themes/base.css?raw";
import githubCss from "../themes/github.css?raw";
import nightCss from "../themes/night.css?raw";
import newsprintCss from "../themes/newsprint.css?raw";
import pixyllCss from "../themes/pixyll.css?raw";
import whiteyCss from "../themes/whitey.css?raw";
import graphiteCss from "../themes/typorium-dark.css?raw";
import { kv } from "../storage/idb";
import { setDiagramAppearance } from "../render/diagrams";

export interface Theme { id: string; name: string; css: string; builtin: boolean }

export const builtinThemes: Theme[] = [
  { id: "github", name: "Github", css: githubCss, builtin: true },
  { id: "newsprint", name: "Newsprint", css: newsprintCss, builtin: true },
  { id: "night", name: "Night", css: nightCss, builtin: true },
  { id: "pixyll", name: "Pixyll", css: pixyllCss, builtin: true },
  { id: "whitey", name: "Whitey", css: whiteyCss, builtin: true },
  { id: "graphite", name: "Graphite", css: graphiteCss, builtin: true },
];

export const baseContentCss = baseCss;

const elementClasses: Record<string, string> = {
  h1: ".md-h1", h2: ".md-h2", h3: ".md-h3", h4: ".md-h4", h5: ".md-h5", h6: ".md-h6",
  p: ".md-p", blockquote: ".md-quote", pre: ".md-fences", code: ".md-code", a: ".md-link",
  strong: ".md-strong", b: ".md-strong", em: ".md-em", i: ".md-em", del: ".md-del", s: ".md-del",
  mark: ".md-mark", hr: ".md-hr-widget", li: ".md-li", kbd: ".md-kbd", u: ".md-u", sup: ".md-sup", sub: ".md-sub",
};
const elementPattern = new RegExp(`(^|[\\s>+~(,])(${Object.keys(elementClasses).join("|")})(?![\\w-])`, "g");
const lineLevel = new Set([".md-h1", ".md-h2", ".md-h3", ".md-h4", ".md-h5", ".md-h6", ".md-p", ".md-quote", ".md-fences", ".md-li"]);

function liveSelector(selector: string): { selector: string; targets: Set<string> } | null {
  const targets = new Set<string>();
  let mapped = selector.replace(/\.CodeMirror-lines|\.CodeMirror-code|\.CodeMirror\b/g, () => { targets.add(".md-fences"); return ".md-fences"; });
  mapped = mapped.replace(/#typora-sidebar\b/g, "#sidebar").replace(/(^|[\s>+~,])content(?![\w-])/g, "$1.editor-pane");
  mapped = mapped.replace(elementPattern, (_all, before: string, tag: string) => {
    targets.add(elementClasses[tag]);
    return before + elementClasses[tag];
  });
  if (!targets.size) return null;
  // Pre/code combos: ".md-fences .md-code" should not double-style code lines.
  mapped = mapped.replace(/\.md-fences\s+\.md-code/g, ".md-fences");
  return { selector: mapped.split(",").map(part => part.includes("#write") || part.includes(".md-live") ? part : `.md-live ${part.trim()}`).join(", "), targets };
}

const dropAlways = new Set(["display", "position", "float", "width", "max-width", "min-width", "height", "max-height", "page-break-before", "page-break-after", "page-break-inside", "break-before", "break-after", "break-inside", "overflow", "overflow-x", "overflow-y", "white-space"]);

function liveDeclarations(style: CSSStyleDeclaration, targets: Set<string>): string {
  const isLine = [...targets].some(target => lineLevel.has(target));
  const fences = targets.has(".md-fences");
  const quote = targets.has(".md-quote");
  const out: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const property = style[i];
    const value = style.getPropertyValue(property);
    const priority = style.getPropertyPriority(property) ? " !important" : "";
    if (isLine && dropAlways.has(property)) continue;
    if (property.startsWith("margin")) {
      if (!isLine) { out.push(`${property}:${value}${priority}`); continue; }
      if (property === "margin-top" && !fences) out.push(`padding-top:${value}${priority}`);
      if (property === "margin-bottom" && !fences) out.push(`padding-bottom:${value}${priority}`);
      continue;
    }
    if (fences && (property.startsWith("border") || property.startsWith("padding") || property === "box-shadow")) continue;
    if (quote && (property.startsWith("border-top") || property.startsWith("border-bottom") || property === "padding-top" || property === "padding-bottom")) continue;
    if (targets.has(".md-li") && (property.startsWith("padding-left") || property === "text-indent" || property === "list-style" || property === "list-style-type")) continue;
    out.push(`${property}:${value}${priority}`);
  }
  return out.join(";");
}

function adaptRules(rules: CSSRuleList): string {
  let out = "";
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const live = liveSelector(rule.selectorText);
      if (!live) continue;
      const declarations = liveDeclarations(rule.style, live.targets);
      if (declarations) out += `${live.selector}{${declarations}}\n`;
    } else if (rule instanceof CSSMediaRule) {
      if (/print/.test(rule.conditionText) && !/screen/.test(rule.conditionText)) continue;
      const inner = adaptRules(rule.cssRules);
      if (inner) out += `@media ${rule.conditionText}{${inner}}\n`;
    } else if (typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule) {
      const inner = adaptRules(rule.cssRules);
      if (inner) out += `@supports ${rule.conditionText}{${inner}}\n`;
    }
  }
  return out;
}

/** Typora-only at-rules and imports that browsers can't resolve are removed. */
export function cleanThemeCss(css: string) {
  return css.replace(/@include-when-export[^;]*;/g, "").replace(/@import\s+url\(\s*["']?(?!https:)[^)]*\)\s*;/g, "");
}

export function adaptTheme(css: string): string {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cleanThemeCss(css).replace(/@import[^;]+;/g, ""));
    return adaptRules(sheet.cssRules);
  } catch {
    return "";
  }
}

export async function customThemes(): Promise<Theme[]> {
  return (await kv.get<Theme[]>("themes")) ?? [];
}

export async function saveCustomTheme(theme: Theme) {
  const themes = (await customThemes()).filter(existing => existing.id !== theme.id);
  themes.push({ ...theme, builtin: false });
  await kv.set("themes", themes);
}

export async function deleteCustomTheme(id: string) {
  await kv.set("themes", (await customThemes()).filter(theme => theme.id !== id));
}

/**
 * Import a Typora theme: the .css file plus, optionally, the files of its
 * companion folder (fonts, images), which are inlined as data URLs.
 */
export async function importTheme(files: File[]): Promise<Theme> {
  const cssFile = files.find(file => file.name.toLowerCase().endsWith(".css"));
  if (!cssFile) throw new Error("Choose a theme .css file (and optionally its asset files).");
  let css = await cssFile.text();
  const assets = new Map<string, File>();
  for (const file of files) if (file !== cssFile) assets.set(file.name.toLowerCase(), file);
  const urls = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)];
  for (const match of urls) {
    const ref = match[2];
    if (/^(data:|https?:|#)/.test(ref)) continue;
    const name = ref.split(/[/\\]/).pop()!.split(/[?#]/)[0].toLowerCase();
    const asset = assets.get(name);
    if (!asset) continue;
    const dataUrl = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(asset);
    });
    css = css.split(match[0]).join(`url("${dataUrl}")`);
  }
  const base = cssFile.name.replace(/\.css$/i, "");
  const name = base.replace(/[-_]+/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
  const theme: Theme = { id: "custom-" + base.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, css: cleanThemeCss(css), builtin: false };
  await saveCustomTheme(theme);
  return theme;
}

let styleElement: HTMLStyleElement | null = null;
let userStyleElement: HTMLStyleElement | null = null;

function luminance(color: string) {
  const probe = document.createElement("div");
  probe.style.color = color;
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255];
  probe.remove();
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function applyTheme(theme: Theme, customCss = "") {
  styleElement ??= document.head.appendChild(Object.assign(document.createElement("style"), { id: "typorium-theme" }));
  userStyleElement ??= document.head.appendChild(Object.assign(document.createElement("style"), { id: "typorium-user-css" }));
  styleElement.textContent = `${baseCss}\n/* theme: ${theme.name} */\n${cleanThemeCss(theme.css)}\n/* live editor adaptation */\n${adaptTheme(theme.css)}`;
  userStyleElement.textContent = customCss ? `${customCss}\n${adaptTheme(customCss)}` : "";
  document.documentElement.dataset.theme = theme.id;
  const background = getComputedStyle(document.documentElement).getPropertyValue("--bg-color").trim() || "#fff";
  const dark = luminance(background) < 0.3;
  document.documentElement.dataset.appearance = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
  setDiagramAppearance(dark ? "dark" : "light");
  return dark;
}

/** CSS for exported HTML: base + theme (unadapted, it targets real elements) + user CSS. */
export function exportCss(theme: Theme, customCss = "") {
  return `${baseCss}\n${cleanThemeCss(theme.css)}\n${customCss}`;
}
