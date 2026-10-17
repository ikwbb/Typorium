// Lezer Markdown extensions for the Typora dialect: ==highlight==, $math$,
// $$math blocks$$, [^footnotes], and YAML front matter. Subscript, superscript,
// emoji and GFM come from @lezer/markdown itself.
import { tags as t, Tag } from "@lezer/highlight";
import type { MarkdownConfig, BlockContext, Line, InlineContext } from "@lezer/markdown";
import { GFM, Subscript, Superscript, Emoji } from "@lezer/markdown";

export const mathTag = Tag.define();
export const highlightTag = Tag.define();

const Punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\xA1‐-‧]/;

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: highlightTag },
    { name: "HighlightMark", style: t.processingInstruction },
  ],
  parseInline: [{
    name: "Highlight",
    parse(cx: InlineContext, next: number, pos: number) {
      if (next != 61 || cx.char(pos + 1) != 61 || cx.char(pos + 2) == 61) return -1;
      const before = cx.slice(pos - 1, pos), after = cx.slice(pos + 2, pos + 3);
      const sBefore = /\s|^$/.test(before), sAfter = /\s|^$/.test(after);
      const pBefore = Punctuation.test(before), pAfter = Punctuation.test(after);
      return cx.addDelimiter(HighlightDelim, pos, pos + 2,
        !sAfter && (!pAfter || sBefore || pBefore),
        !sBefore && (!pBefore || sAfter || pAfter));
    },
    after: "Emphasis",
  }],
};

export const InlineMath: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: mathTag },
    { name: "InlineMathMark", style: t.processingInstruction },
  ],
  parseInline: [{
    name: "InlineMath",
    parse(cx: InlineContext, next: number, pos: number) {
      if (next != 36 || cx.char(pos + 1) == 36) return -1;
      if (pos > cx.offset && cx.char(pos - 1) == 36) return -1;
      const first = cx.char(pos + 1);
      if (first == 32 || first == 9 || first == -1) return -1;
      for (let i = pos + 1; i < cx.end; i++) {
        const ch = cx.char(i);
        if (ch == 92) { i++; continue; }
        if (ch != 36) continue;
        const prev = cx.char(i - 1);
        if (prev == 32 || prev == 9) continue;
        const after = cx.char(i + 1);
        if (after >= 48 && after <= 57) continue;
        return cx.addElement(cx.elt("InlineMath", pos, i + 1, [
          cx.elt("InlineMathMark", pos, pos + 1),
          cx.elt("InlineMathMark", i, i + 1),
        ]));
      }
      return -1;
    },
    before: "Emphasis",
  }],
};

const depthOf = (line: Line) => (line as unknown as { depth: number }).depth;

function blockMathOpen(line: Line) {
  return line.next == 36 && line.text.charCodeAt(line.pos + 1) == 36 && line.indent - line.baseIndent < 4;
}

export const BlockMath: MarkdownConfig = {
  defineNodes: [
    { name: "BlockMath", block: true, style: mathTag },
    { name: "BlockMathMark", style: t.processingInstruction },
  ],
  parseBlock: [{
    name: "BlockMath",
    parse(cx: BlockContext, line: Line) {
      if (!blockMathOpen(line)) return false;
      const from = cx.lineStart + line.pos;
      const rest = line.text.slice(line.pos + 2);
      const marks = [cx.elt("BlockMathMark", from, from + 2)];
      // Single-line form: $$ x^2 $$
      const single = /^(.*\S.*?)\$\$\s*$/.exec(rest);
      if (single && single[1].trim()) {
        const close = cx.lineStart + line.pos + 2 + single[1].length;
        marks.push(cx.elt("BlockMathMark", close, close + 2));
        const end = cx.lineStart + line.text.length;
        cx.nextLine();
        cx.addElement(cx.elt("BlockMath", from, end, marks));
        return true;
      }
      while (cx.nextLine() && depthOf(line) >= cx.depth) {
        marks.push(...line.markers);
        const text = line.text.slice(line.pos);
        const close = /^(.*?)\$\$\s*$/.exec(text);
        if (close && line.indent - line.baseIndent < 4) {
          const at = cx.lineStart + line.pos + close[1].length;
          marks.push(cx.elt("BlockMathMark", at, at + 2));
          cx.nextLine();
          break;
        }
      }
      cx.addElement(cx.elt("BlockMath", from, cx.prevLineEnd(), marks));
      return true;
    },
    endLeaf: (_cx, line) => blockMathOpen(line),
    before: "FencedCode",
  }],
};

export const Footnotes: MarkdownConfig = {
  defineNodes: [
    { name: "FootnoteReference", style: t.link },
    { name: "FootnoteMark", style: t.processingInstruction },
    { name: "FootnoteLabel", style: t.labelName },
    { name: "FootnoteDefinition", block: true },
  ],
  parseInline: [{
    name: "FootnoteReference",
    parse(cx: InlineContext, next: number, pos: number) {
      if (next != 91 || cx.char(pos + 1) != 94) return -1;
      for (let i = pos + 2; i < cx.end && i < pos + 200; i++) {
        const ch = cx.char(i);
        if (ch == 32 || ch == 9 || ch == 91) return -1;
        if (ch == 93) {
          if (i == pos + 2) return -1;
          return cx.addElement(cx.elt("FootnoteReference", pos, i + 1, [
            cx.elt("FootnoteMark", pos, pos + 2),
            cx.elt("FootnoteLabel", pos + 2, i),
            cx.elt("FootnoteMark", i, i + 1),
          ]));
        }
      }
      return -1;
    },
    before: "Link",
  }],
  parseBlock: [{
    name: "FootnoteDefinition",
    parse(cx: BlockContext, line: Line) {
      const match = /^\[\^([^\]\s]+)\]:[ \t]?/.exec(line.text.slice(line.pos));
      if (!match || line.indent - line.baseIndent >= 4) return false;
      const from = cx.lineStart + line.pos;
      const labelEnd = from + 2 + match[1].length;
      const children = [
        cx.elt("FootnoteMark", from, from + 2),
        cx.elt("FootnoteLabel", from + 2, labelEnd),
        cx.elt("FootnoteMark", labelEnd, labelEnd + 2),
        ...cx.parser.parseInline(line.text.slice(line.pos + match[0].length), from + match[0].length),
      ];
      // Continuation lines must be indented.
      while (cx.nextLine()) {
        if (depthOf(line) < cx.depth) break;
        if (line.pos == line.text.length || line.indent - line.baseIndent < 4) break;
        children.push(...cx.parser.parseInline(line.text.slice(line.pos), cx.lineStart + line.pos));
      }
      cx.addElement(cx.elt("FootnoteDefinition", from, cx.prevLineEnd(), children));
      return true;
    },
    before: "LinkReference",
  }],
};

export const FrontMatter: MarkdownConfig = {
  defineNodes: [
    { name: "FrontMatter", block: true, style: t.meta },
    { name: "FrontMatterMark", style: t.processingInstruction },
  ],
  parseBlock: [{
    name: "FrontMatter",
    parse(cx: BlockContext, line: Line) {
      if (cx.lineStart != 0 || !/^---\s*$/.test(line.text)) return false;
      // Look ahead for a closing fence so a leading horizontal rule stays a rule.
      const input = (cx as unknown as { input?: { length: number; read(from: number, to: number): string } }).input;
      if (input) {
        const head = input.read(0, Math.min(input.length, 64 * 1024));
        if (!/\n(---|\.\.\.)[ \t]*(\n|$)/.test(head.slice(3))) return false;
      }
      const marks = [cx.elt("FrontMatterMark", 0, 3)];
      while (cx.nextLine()) {
        if (/^(---|\.\.\.)\s*$/.test(line.text)) {
          marks.push(cx.elt("FrontMatterMark", cx.lineStart, cx.lineStart + 3));
          cx.nextLine();
          break;
        }
      }
      cx.addElement(cx.elt("FrontMatter", 0, cx.prevLineEnd(), marks));
      return true;
    },
    before: "HorizontalRule",
  }],
};

export const typoraExtensions = [GFM, Subscript, Superscript, Emoji, Highlight, InlineMath, BlockMath, Footnotes, FrontMatter];
