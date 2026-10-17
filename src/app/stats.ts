// Word count and reading time. Like Typora, each CJK character counts as a word
// and Markdown syntax (markers, URLs, front matter) is not counted.

export interface DocumentStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  paragraphs: number;
  lines: number;
  minutes: number;
}

const cjk = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/gu;

export function plainText(markdown: string) {
  return markdown
    .replace(/^---\n[\s\S]*?\n(?:---|\.\.\.)\n/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^(```|~~~).*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "")
    .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/gm, "")
    .replace(/[*_~=`|$\\]/g, "");
}

export function documentStats(markdown: string, readingSpeed = 230): DocumentStats {
  const text = plainText(markdown);
  const cjkCount = (text.match(cjk) ?? []).length;
  const latinWords = (text.replace(cjk, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []).length;
  const words = cjkCount + latinWords;
  const characters = [...text.replace(/\n/g, "")].length;
  const charactersNoSpaces = [...text.replace(/\s/g, "")].length;
  const paragraphs = markdown.split(/\n\s*\n/).filter(block => block.trim()).length;
  const lines = markdown ? markdown.split("\n").length : 0;
  // CJK reads at roughly 2x the per-"word" rate of Latin text.
  const minutes = Math.max(words ? 1 : 0, Math.round((latinWords + cjkCount / 2) / Math.max(50, readingSpeed)));
  return { words, characters, charactersNoSpaces, paragraphs, lines, minutes };
}
