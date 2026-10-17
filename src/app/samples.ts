// Built-in documents: the first-run welcome guide and a Markdown reference.
import { isApple } from "./platform";

const mod = isApple ? "⌘" : "Ctrl";

export const welcomeDocument = `# Welcome to Typorium

Typorium is a Markdown editor that works the way Typora does: you type Markdown and it turns into formatted text as you go. Put the cursor inside **bold text**, a [link](https://typora.io) or a heading and the Markdown syntax appears so you can change it; move away and it disappears again.

[TOC]

## Try it

Type these at the start of a new line:

| You type           | You get               |
| ------------------ | --------------------- |
| \`# \` to \`###### \`  | Headings              |
| \`- \` or \`1. \`      | Lists                 |
| \`- [ ] \`           | A task list           |
| \`> \`               | A quote               |
| \`\` \`\`\`js \`\` + Enter | A code block          |
| \`$$\` + Enter       | A math block          |
| \`---\` + Enter      | A horizontal line     |

To make a table, type a header row such as \`| Name | Value |\` and press Enter.

Inline styles work the same way: \`**strong**\`, \`*emphasis*\`, \`~~strike~~\`, \`==highlight==\`, \`\` \`code\` \`\`, \`$x^2$\`, \`H~2~O\`, \`x^2^\`, and \`:smile:\` for emoji :tada:.

- [x] Press **Enter** to start a new paragraph and **Shift+Enter** for a line break.
- [ ] Press **${mod}+/** to switch between live preview and source code mode.
- [ ] Select some text and press **${mod}+B**, **${mod}+I** or **${mod}+K**.
- [ ] Paste or drop an image: it is copied into an \`assets\` folder next to the document.

## Math and diagrams

Inline math such as $e^{i\\pi} + 1 = 0$ and display math:

$$
\\begin{aligned}
\\nabla \\cdot \\vec{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\
\\nabla \\times \\vec{B} &= \\mu_0 \\vec{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\vec{E}}{\\partial t}
\\end{aligned}
$$

\`\`\`mermaid
graph LR
  Write[Write Markdown] --> See[See it formatted]
  See --> Export[Export to HTML or PDF]
\`\`\`

## Code

\`\`\`python
def greet(name: str) -> str:
    return f"Hello, {name}!"
\`\`\`

> [!TIP]
> Click the language label on a code block to change its language, and the copy button to copy the code.

## Where documents live

- The **Library** keeps documents inside this browser, on this device. It works offline and on iPad.
- In Chrome and Edge you can also **open a folder** on your disk (File › Open Folder) and edit the files in it directly.
- Use **File › Export** to save HTML, PDF or Markdown copies anywhere.

Install Typorium as an app from **Help › Install Typorium as an App** to use it full screen and offline. On iPad, use Safari's Share button and choose *Add to Home Screen*.

## Themes

Typorium ships with the GitHub, Newsprint, Night, Pixyll, Whitey and Graphite themes, and can import Typora themes: choose **Themes › Import Typora Theme…** and select the theme's \`.css\` file together with its fonts and images.

---

Open **Help › Markdown Reference** for the full syntax, and **Help › Keyboard Shortcuts** for the shortcut list. Happy writing! :writing_hand:
`;

export const markdownReference = `---
title: Markdown Reference
---

# Markdown Reference

Typorium uses [GitHub Flavored Markdown](https://github.github.com/gfm/) with the same extensions as Typora. This document shows each of them; switch to source code mode (**${mod}+/**) to see the Markdown behind it.

[TOC]

## Block Elements

### Paragraph and line breaks

A paragraph is one or more lines of text. Press **Enter** to start a new paragraph, which leaves a blank line in the Markdown source. Press **Shift+Enter** for a single line break inside a paragraph.

### Headings

\`\`\`markdown
# This is an H1
## This is an H2
###### This is an H6
\`\`\`

Press **${mod}+1** to **${mod}+6** to turn the current paragraph into a heading, and **${mod}+0** to turn it back.

### Blockquotes

> This is a blockquote with two paragraphs.
>
> Type \`>\` followed by the quote's text.

GitHub-style alerts are supported too:

> [!NOTE]
> Useful information.

> [!WARNING]
> Something to be careful about.

### Lists

* Red
* Green
* Blue

1. Red
2. Green
3. Blue

Press **Tab** and **Shift+Tab** inside a list item to indent and outdent it. Press **Enter** on an empty item to leave the list.

### Task lists

- [ ] an unchecked task
- [x] a checked task

Click a checkbox to toggle it.

### Fenced code blocks

\`\`\`javascript
function fancyAlert(arg) {
  if (arg) {
    $.facebox({ div: "#foo" });
  }
}
\`\`\`

Type three backticks and a language name, then press **Enter**.

### Math blocks

$$
\\mathbf{V}_1 \\times \\mathbf{V}_2 = \\begin{vmatrix}
\\mathbf{i} & \\mathbf{j} & \\mathbf{k} \\\\
\\frac{\\partial X}{\\partial u} & \\frac{\\partial Y}{\\partial u} & 0 \\\\
\\frac{\\partial X}{\\partial v} & \\frac{\\partial Y}{\\partial v} & 0
\\end{vmatrix}
$$

Math is rendered with MathJax and accepts TeX and LaTeX, including the \`ams\`, \`mhchem\` (for example $\\ce{H2O}$), \`physics\` and \`cancel\` extensions.

### Tables

| First Header | Second Header | Right aligned |
| :----------- | :-----------: | ------------: |
| Content Cell | Content Cell  | 1             |
| Content Cell | Content Cell  | 2             |

Type \`| First Header | Second Header |\` and press **Enter** to create a table. Use the toolbar above a table to align columns and add or remove rows and columns. **Tab** moves to the next cell, and **${mod}+Enter** adds a row.

### Footnotes

You can create footnotes like this[^footnote].

[^footnote]: Here is the *text* of the **footnote**.

### Horizontal rules

Type \`***\` or \`---\` on a blank line and press **Enter**.

---

### YAML front matter

Type \`---\` at the very top of a document and press **Enter** to add front matter. Typorium understands Typora's \`typora-root-url\` and \`typora-copy-images-to\` keys.

### Table of contents

Type \`[TOC]\` on its own line. It updates as you edit headings.

### Diagrams

Typorium draws [Mermaid](https://mermaid.js.org) diagrams, plus Typora's \`sequence\` and \`flow\` code blocks.

\`\`\`mermaid
sequenceDiagram
  Alice->>Bob: Hello Bob, how are you?
  Bob-->>Alice: Great!
\`\`\`

\`\`\`flow
st=>start: Start
op=>operation: Do something
cond=>condition: Done?
e=>end: End
st->op->cond
cond(yes)->e
cond(no)->op
\`\`\`

## Span Elements

### Links

This is [an example](https://example.com/ "Title") inline link. Reference links work too: [this one][ref].

[ref]: https://example.com/ "Optional title"

Hold **${mod}** and click a link to open it, or tap it and use the link popup. Links to headings (\`[text](#block-elements)\`) jump inside the document, and links to other \`.md\` files open them.

### URLs

Typed URLs such as <https://typora.io> and www.example.com become links automatically.

### Images

\`\`\`markdown
![Alt text](assets/picture.png "Optional title")
\`\`\`

Drop or paste an image to copy it next to the document. Use \`<img src="..." style="zoom:50%">\` to resize an image, the way Typora does.

### Emphasis and strong

*single asterisks* and _single underscores_ for emphasis, **double asterisks** and __double underscores__ for strong.

### Code

Use the \`printf()\` function.

### Strikethrough

~~Mistaken text.~~

### Highlight, subscript and superscript

==highlighted==, H~2~O and X^2^.

### Underline

<u>Underline</u> uses HTML, like in Typora: press **${mod}+U**.

### Emoji

Type \`:\` followed by an emoji name, for example :smile: :rocket: :+1:.

### Inline math

$\\lim_{x \\to \\infty} \\exp(-x) = 0$

### HTML

You can use <kbd>Ctrl</kbd>, <mark>mark</mark>, <span style="color:#d33">colored text</span> and other HTML. Scripts are never run.
`;
