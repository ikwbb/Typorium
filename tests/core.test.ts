// Unit tests for pure helpers. Run with `npm test` (Node 22.18+ runs TypeScript directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, join, dirname, basename, extname, stem, relative, isMarkdown, encodePath } from "../src/storage/paths.ts";
import { documentStats } from "../src/app/stats.ts";

test("paths", () => {
  assert.equal(normalize("a/./b/../c.md"), "a/c.md");
  assert.equal(join("notes", "../img", "x.png"), "img/x.png");
  assert.equal(dirname("a/b/c.md"), "a/b");
  assert.equal(dirname("c.md"), "");
  assert.equal(basename("a/b/c.md"), "c.md");
  assert.equal(extname("a/b/C.MD"), ".md");
  assert.equal(extname(".hidden"), "");
  assert.equal(stem("a/report.final.md"), "report.final");
  assert.equal(relative("notes/day", "notes/assets/a.png"), "../assets/a.png");
  assert.equal(relative("", "assets/a.png"), "assets/a.png");
  assert.ok(isMarkdown("x.markdown") && !isMarkdown("x.png"));
  assert.equal(encodePath("my assets/a b.png"), "my%20assets/a%20b.png");
});

test("word count ignores Markdown syntax and counts CJK characters", () => {
  const stats = documentStats("---\ntitle: x\n---\n# Hello **world**\n\n- [ ] a [link](http://x.y/z)\n\n中文字");
  assert.equal(stats.words, 2 + 2 + 3);
  assert.equal(stats.paragraphs, 3);
  assert.equal(documentStats("").words, 0);
});
