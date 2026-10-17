// Code highlighting shared by the live editor and exported HTML. Token classes
// follow CodeMirror 5 naming (cm-keyword, cm-string, ...) because Typora themes
// style code blocks with `.cm-s-inner .cm-keyword` selectors.
import { tags as t, tagHighlighter, highlightTree } from "@lezer/highlight";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Parser } from "@lezer/common";

export const cm5Highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self], class: "cm-keyword" },
  { tag: [t.atom, t.bool, t.null], class: "cm-atom" },
  { tag: [t.number, t.integer, t.float], class: "cm-number" },
  { tag: [t.definition(t.variableName), t.function(t.definition(t.variableName))], class: "cm-def" },
  { tag: t.variableName, class: "cm-variable" },
  { tag: [t.local(t.variableName), t.special(t.variableName)], class: "cm-variable-2" },
  { tag: [t.typeName, t.className, t.namespace], class: "cm-variable-3" },
  { tag: [t.propertyName, t.definition(t.propertyName)], class: "cm-property" },
  { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.compareOperator, t.updateOperator], class: "cm-operator" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "cm-comment" },
  { tag: [t.string, t.docString, t.character], class: "cm-string" },
  { tag: [t.regexp, t.escape, t.special(t.string), t.url], class: "cm-string-2" },
  { tag: [t.meta, t.annotation, t.processingInstruction], class: "cm-meta" },
  { tag: [t.function(t.variableName), t.standard(t.variableName)], class: "cm-builtin" },
  { tag: [t.bracket, t.paren, t.brace, t.squareBracket, t.angleBracket], class: "cm-bracket" },
  { tag: t.tagName, class: "cm-tag" },
  { tag: t.attributeName, class: "cm-attribute" },
  { tag: t.attributeValue, class: "cm-string" },
  { tag: t.heading, class: "cm-header" },
  { tag: t.quote, class: "cm-quote" },
  { tag: t.contentSeparator, class: "cm-hr" },
  { tag: [t.link], class: "cm-link" },
  { tag: t.invalid, class: "cm-error" },
  { tag: t.inserted, class: "cm-positive" },
  { tag: t.deleted, class: "cm-negative" },
  { tag: t.strong, class: "cm-strong" },
  { tag: t.emphasis, class: "cm-em" },
  { tag: t.labelName, class: "cm-qualifier" },
]);

const aliases: Record<string, string> = {
  js: "javascript", ts: "typescript", py: "python", rb: "ruby", sh: "shell", bash: "shell",
  zsh: "shell", yml: "yaml", md: "markdown", "c++": "cpp", "c#": "csharp", cs: "csharp",
  objc: "objective-c", kt: "kotlin", rs: "rust", golang: "go", ps1: "powershell", tex: "latex",
};

export function findLanguage(info: string) {
  const name = info.trim().split(/[\s{]/)[0].toLowerCase();
  if (!name) return null;
  return LanguageDescription.matchLanguageName(languages, aliases[name] || name, true);
}

const parsers = new Map<LanguageDescription, Parser>();

export async function loadLanguage(info: string): Promise<Parser | null> {
  const description = findLanguage(info);
  if (!description) return null;
  const cached = parsers.get(description);
  if (cached) return cached;
  try {
    const support = await description.load();
    parsers.set(description, support.language.parser);
    return support.language.parser;
  } catch { return null; }
}

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

/** Highlight synchronously when the language is already loaded; otherwise plain. */
export function highlightCode(code: string, info: string): string {
  const description = findLanguage(info);
  const parser = description && parsers.get(description);
  if (!parser) return escapeHtml(code);
  let html = "", pos = 0;
  const tree = parser.parse(code);
  highlightTree(tree, cm5Highlighter, (from, to, classes) => {
    if (from > pos) html += escapeHtml(code.slice(pos, from));
    html += `<span class="${classes}">${escapeHtml(code.slice(from, to))}</span>`;
    pos = to;
  });
  return html + escapeHtml(code.slice(pos));
}

export async function preloadLanguages(source: string) {
  const infos = new Set<string>();
  for (const match of source.matchAll(/^\s*(?:`{3,}|~{3,})\s*([\w#+.-]+)/gm)) infos.add(match[1]);
  await Promise.all([...infos].map(loadLanguage));
}
