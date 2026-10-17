<p align="center"><img src="public/icons/icon.svg" width="88" height="88" alt=""></p>

# Typorium

Typorium is a Typora-style WYSIWYG Markdown editor that runs in the browser and installs as a Progressive Web App. You type Markdown and it turns into formatted text as you go. When the cursor touches a formatted element, its Markdown syntax appears so you can edit it. Your documents are ordinary `.md` files.

It runs on desktop browsers (Chrome, Edge, Safari, Firefox) and on iPadOS, where it adds a touch formatting bar above the on-screen keyboard and works offline once installed to the Home Screen.

Typorium is an independent project and is not affiliated with Typora.

## Quick start

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # type-check, then build the static site and service worker into dist/
npm run preview    # serve dist/ to test the production build and offline mode
npm test           # unit tests (Node 22.18+)
npm run icons      # re-render the PNG icons from public/icons/*.svg (uses Playwright's Chromium)
```

`dist/` is a static site. The build uses relative URLs, so you can host it on any static host or sub-path (GitHub Pages, Netlify, Cloudflare Pages, nginx). Serve it over HTTPS: service workers, installation and folder access only work on secure origins (`localhost` is fine for testing).

### Deploying to GitHub Pages

The repository includes `.github/workflows/deploy.yml`, which tests, builds and publishes `dist/` on every push to `main`. Turn it on once under **Settings › Pages › Source: GitHub Actions**. The site appears at `https://<user>.github.io/<repo>/`. Because the build uses relative paths, it needs no base-path setting, and the service worker's scope is limited to that sub-path.

### Installing the app

- **iPad and iPhone:** open the site in Safari, tap Share, then **Add to Home Screen**. Installing matters on iPadOS: Safari can clear a website's storage after weeks of inactivity, but it doesn't do that for Home Screen apps.
- **Chrome and Edge (desktop or Android):** use the install icon in the address bar, or **Help › Install Typorium as an App**. The installed app can open `.md` files straight from the operating system ("Open with Typorium").
- **Safari on macOS:** File › Add to Dock.

## Features

Typorium aims to match Typora's behaviour and file format. Documents written in either app open in the other.

**Live preview editing**
- Headings, emphasis, strong, strikethrough, `==highlight==`, `~sub~`, `^sup^`, `<u>underline</u>`, `<kbd>`, inline code, links, reference links, autolinks, images, emoji shortcodes, footnotes, inline HTML and HTML blocks. Syntax is hidden until the cursor touches it.
- Typora's typing behaviours:
  - **Enter** starts a new paragraph and **Shift+Enter** adds a line break.
  - A code fence or `$$` closes itself when you press Enter.
  - Typing `| a | b |` and pressing Enter creates a table.
  - Pressing Enter on an empty list item outdents it or leaves the list, and an empty quote line leaves the quote.
  - Backspace and Delete merge paragraphs.
  - Arrowing past a block at the edge of the document adds a paragraph.
  - Typing `*`, `_`, `` ` ``, `~`, `=`, `$` or a bracket with text selected wraps the selection.
- **Lists and tasks:** bullets, numbers and checkboxes are drawn with hanging indents. Click a checkbox to toggle it. **Tab** and **Shift+Tab** indent and outdent.
- **Tables:** each cell is edited in place, and the toolbar sets alignment and adds, moves or deletes rows and columns. **Tab** moves between cells, **Mod+Enter** adds a row, and the Markdown source is kept padded and aligned.
- **Code blocks:** syntax highlighting for more than 100 languages, an editable language label and a copy button. Code classes follow Typora's CodeMirror names (`cm-keyword`, …), so Typora themes colour them.
- **Math:** inline `$…$` and block `$$…$$`, rendered by MathJax 4 (TeX to SVG). Packages include AMS, mhchem, physics, cancel, braket, mathtools and others. Math blocks show a live preview while you edit them.
- **Diagrams:** Mermaid, plus Typora's `sequence` and `flow` code blocks (translated to Mermaid).
- **Document furniture:** `[TOC]` blocks that update as you edit, YAML front matter, GitHub-style alerts (`> [!NOTE]`), and horizontal rules.
- **Source code mode** (**Mod+/**), focus mode (**F8**), typewriter mode (**F9**) and find and replace.

**Files**
- **Library:** documents stored in the browser with IndexedDB. Works everywhere, including iPadOS.
- **Folders on disk:** File › Open Folder, in Chromium browsers. Typorium reads and writes the folder's Markdown files and images directly.
- **Single files:** opened from disk, or launched from the OS by the installed app.
- **Sidebar:** file tree (create, rename, duplicate, move by drag, delete), document outline, and search across files with case, whole-word and regex options.
- **Quick Open** (**Mod+P**, or **⌘⇧O** on Apple devices) and a **Command Palette** (**Mod+Shift+P**).
- **Saving and recovery:**
  - Autosave, enabled by default.
  - Reopens the documents from your last session and keeps unsaved drafts across reloads and crashes.
  - Warns when a file was changed on disk by another app.
  - Keeps the file's BOM and CRLF line endings.
- **Images:** pasted or dropped images are copied to `./assets` next to the document, like Typora's "copy image to ./assets" option. Typora's `typora-copy-images-to` and `typora-root-url` front matter keys are honoured, and `<img style="zoom:50%">` resizes images.

**Themes and export**
- Built-in themes: GitHub, Newsprint, Night, Pixyll, Whitey and Graphite.
- **Typora themes can be imported.** Select the theme's `.css` file together with its font and image files. Typorium inlines those assets and maps the theme's `#write h1`, `blockquote`, `pre`, `.md-fences` and other rules onto the live editor, so the theme also styles editing.
- Typorium follows the system dark mode by switching to Night. You can override this in the Themes menu.
- Custom CSS can be added in Preferences, like Typora's `base.user.css`.
- **Export:**
  - HTML, with or without styles. Images are embedded and the markup uses Typora's export structure (`#write`, `.md-fences`, …).
  - PDF through the print dialog, with page size and margins set in Preferences.
  - Markdown.
  - Copy as HTML or as Markdown.
- **Import:** HTML is converted to Markdown, and rich text you paste becomes Markdown.

**iPad and touch**
- A formatting bar above the keyboard with headings, inline styles, lists, indent, quote, table, code, math, image and more. Buttons don't steal focus, so the keyboard stays up.
- The layout follows the visual viewport, so the keyboard never covers the caret.
- Larger touch targets, a sidebar drawer on narrow screens, long-press context menus in the file tree, and safe-area insets.
- Exports use the share sheet, so **Save to Files** works.
- Uses the native selection and caret, so iPadOS text selection, the magnifier, dictation and Scribble keep working.

## Keyboard shortcuts

Typorium uses Typora's shortcuts. Mod is ⌘ on Apple devices and Ctrl elsewhere.

| Action | Shortcut | Action | Shortcut |
| --- | --- | --- | --- |
| Heading 1–6 / Paragraph | Mod+1…6 / Mod+0 | Bold / Italic / Underline | Mod+B / Mod+I / Mod+U |
| Increase / decrease heading | Mod+= / Mod+- | Inline code | Mod+Shift+` |
| Table | Mod+T | Hyperlink / Image | Mod+K / Mod+Shift+I |
| Code fence / Math block | Mod+Shift+K / Mod+Shift+M | Highlight | Mod+Shift+H |
| Quote | Mod+Shift+Q | Clear format | Mod+\ |
| Ordered / bullet list | Mod+Shift+[ / Mod+Shift+] | Source code mode | Mod+/ |
| Indent / outdent | Mod+] / Mod+[ | Sidebar / Outline / Files | Mod+Shift+L / 1 / 2 |
| Select line / word / scope | Mod+L / Mod+D / Mod+E | Search in files | Mod+Shift+F |
| Save / Save As | Mod+S / Mod+Shift+S | Focus / Typewriter mode | F8 / F9 |

**Help › Keyboard Shortcuts** shows the full list.

## Architecture

```
src/
  main.ts                 bootstrap and service worker registration
  editor/                 the live-preview editor (CodeMirror 6)
    syntax.ts             Lezer Markdown extensions: ==mark==, $math$, $$block$$, footnotes, front matter
    inline.ts             inline/line decorations: hidden marks, list markers, links, images, emoji, inline HTML
    blocks.ts             block decorations: code fences, math, diagrams, tables, HTML, TOC, front matter
    table.ts              the table widget: in-place cell editing that writes back to Markdown
    widgets.ts            rendered widgets (math, diagram, image, checkbox, TOC, …)
    commands.ts           Typora commands and typing behaviours (Enter, Backspace, lists, formats, …)
    editor.ts             MarkdownEditor: extensions, keymaps, paste/drop/copy, modes, settings
  render/                 Markdown → HTML for export, copy and HTML widgets
    markdown.ts           markdown-it with Typora's extensions and DOM conventions, DOMPurify
    highlight.ts          Lezer-based highlighting with Typora/CodeMirror 5 token classes
    math.ts, mathEngine.ts  MathJax 4 TeX → SVG, bundled fonts (offline)
    diagrams.ts           Mermaid plus flowchart.js / js-sequence translation
  storage/                IndexedDB Library, File System Access folders, path helpers
  app/                    the application shell
    app.ts                commands, menus, documents, files, images, export, PWA glue
    documents.ts          open documents, encoding/line endings, session and draft recovery
    sidebar.ts            file tree, outline, search
    themes.ts             built-in themes and the Typora theme adapter
    formatbar.ts          touch formatting bar and visual-viewport handling
    palette.ts, preferencesDialog.ts, exporter.ts, ui.ts, menus.ts, …
  themes/                 theme CSS in Typora's format (variables + #write rules)
  styles/                 editor and application chrome styles
```

**How live preview works.** The document is always plain Markdown in a CodeMirror 6 editor. Lezer parses it incrementally, and decorations do the rest: marks hide syntax, line classes style blocks, and widgets replace rendered blocks such as math, diagrams and tables. An element shows its source only while the selection touches it, and hidden block prefixes such as `#` and `>` are atomic, so the caret skips them. Because nothing is converted back from HTML, the file is never rewritten behind your back. An untouched document saves byte for byte, including front matter, blank lines and CRLF.

## What was kept from open-typora, and what was rebuilt

The [open-typora](https://github.com/AniChikage/open-typora) project was the reference.

| Area | open-typora | Typorium |
| --- | --- | --- |
| Editing core | A custom `contenteditable` "rich kernel": a block model, DOM-range bookmarks and its own transaction and undo layer, with separate CodeMirror instances for source mode, code and formulas. | **Rebuilt** on CodeMirror 6 decorations over the Markdown text. One document, one undo history, and one selection for both modes. Input methods (IME), mobile keyboards and iPadOS selection are handled by a mature editor instead of custom `beforeinput` code, which is the fragile part of the original on WebKit and touch devices. |
| Platform | Swift/AppKit + WKWebView on macOS, Electron on Windows, plus an in-memory web demo. | **Rebuilt** as a single PWA. Native file access is replaced by an IndexedDB Library everywhere and the File System Access API where supported. The native PDF exporter is replaced by print-to-PDF. |
| Math | MathJax 4 SVG with bundled New Computer Modern fonts. | **Kept** (same engine and approach, lazy-loaded and cached). |
| Diagrams | Mermaid. | **Kept**, with translators added for Typora's `flow` and `sequence` blocks. |
| Markdown rendering for export | markdown-it. | **Kept** markdown-it. Rewritten to emit Typora's export DOM, so Typora themes style exports. |
| Clipboard | HTML ↔ Markdown conversion. | **Kept the idea**, reimplemented with Turndown rules for underline, highlight, sub/sup, math and fenced languages. |
| Themes | Six built-in themes and local CSS. | **Kept** the six-theme idea with new CSS. Added a Typora theme adapter that maps imported themes onto the live editor. |
| Feature list | `docs/feature-parity.md`. | Used as the checklist. |
| Plugins, backgrounds, Pandoc, legacy encodings | Present. | **Dropped** for now. They depend on Node/Electron or native code, or they are outside Typora's core feature set. |

## Defaults

- **Library first:** new documents are saved to the Library, which works in every browser including on iPad. Open Folder is offered where the browser supports it.
- **Autosave on:** Typora's default is off, but losing work in a browser tab is too easy.
- **Images:** copied to `./assets`, relative to the document.
- **Theme:** GitHub. When the system is in dark mode, Night is used.
- **Shortcuts:** Typora's, with ⌘ on Apple devices. Quick Open is ⌘⇧O on Apple devices because Safari reserves ⌘P.
- **MathJax rather than KaTeX:** MathJax is what Typora uses, so documents render the same.
- **Native selection:** CodeMirror's custom selection drawing is turned off, so iPadOS handles text selection.

## Known limitations

- No Pandoc-based formats (Word, ePub, LaTeX, …) and no import of legacy encodings (GBK, Shift JIS, …). Files are read and written as UTF-8, with or without a BOM.
- Folders on disk need the File System Access API (Chrome, Edge, Opera, and other Chromium browsers on desktop). Safari, Firefox and iPadOS use the Library, plus File › Open, Import and Export.
- Library documents live in this browser on this device. They are not synced.
- Imported Typora themes restyle editing through a mapping, so rules that depend on Typora's exact DOM, such as sidebar internals or `::before` content on some elements, may not carry over. Exports use the theme unmodified.
- PDF export uses the browser's print dialog. It has no page header or footer settings.
- The service worker precaches the whole app, about 18 MB, mostly MathJax fonts and Mermaid, so math and diagrams work offline.

## License

MIT. See [LICENSE](LICENSE).
