// Menu structure mirroring Typora's menu bar. Entries reference command ids.
export type MenuEntry = string | "-" | { label: string; items: MenuEntry[] | (() => MenuEntry[]) };

export interface MenuDefinition { id: string; label: string; items: MenuEntry[] | (() => MenuEntry[]) }

export const menuBar: MenuDefinition[] = [
  { id: "file", label: "File", items: [
    "file.new", "file.open", "file.openFolder", "file.quickOpen", { label: "Open Recent", items: ["file.recent"] }, "-",
    "file.save", "file.saveAs", "file.rename", "file.moveTo", "file.revealInSidebar", "file.delete", "-",
    "file.import", { label: "Export", items: ["export.pdf", "export.html", "export.htmlPlain", "export.markdown", "export.copyHtml"] },
    "file.print", "-", "file.properties", "file.close", "-", "app.preferences",
  ] },
  { id: "edit", label: "Edit", items: [
    "edit.undo", "edit.redo", "-", "edit.cut", "edit.copy", "edit.paste", "-",
    "edit.copyMarkdown", "edit.copyHtml", "edit.pastePlain", "-",
    "edit.selectAll", "edit.selectScope", "edit.selectLine", "edit.selectWord", "edit.deleteWord", "-",
    "edit.moveLineUp", "edit.moveLineDown", "-",
    "edit.find", "edit.replace", "edit.findNext", "edit.findPrevious", "edit.searchFiles", "-",
    { label: "Emoji & Symbols", items: ["edit.emoji"] },
  ] },
  { id: "paragraph", label: "Paragraph", items: [
    "para.h1", "para.h2", "para.h3", "para.h4", "para.h5", "para.h6", "-", "para.paragraph", "-",
    "para.headingUp", "para.headingDown", "-",
    "para.table", "para.code", "para.math", "-",
    "para.quote", "-", "para.orderedList", "para.bulletList", "para.taskList", "-",
    { label: "Task Status", items: ["para.toggleTask", "para.taskDone", "para.taskUndone"] },
    { label: "List Indentation", items: ["para.indent", "para.outdent"] }, "-",
    "para.insertBefore", "para.insertAfter", "-",
    "para.linkReference", "para.footnote", "-", "para.hr", "para.toc", "para.yaml",
  ] },
  { id: "format", label: "Format", items: [
    "fmt.strong", "fmt.emphasis", "fmt.underline", "fmt.code", "-",
    "fmt.strike", "fmt.highlight", "fmt.superscript", "fmt.subscript", "fmt.comment", "fmt.inlineMath", "fmt.kbd", "-",
    "fmt.link", "fmt.image", "-", "fmt.clear",
  ] },
  { id: "view", label: "View", items: [
    "view.source", "-", "view.sidebar", "view.outline", "view.files", "view.search", "-",
    "view.focus", "view.typewriter", "-", "view.statusBar", "view.formatBar", "-",
    "view.zoomIn", "view.zoomOut", "view.zoomReset", "-", "view.fullscreen", "-", "view.commandPalette",
  ] },
  { id: "themes", label: "Themes", items: () => ["theme.list", "-", "theme.import", "theme.manage", "-", "theme.appearanceAuto", "theme.appearanceLight", "theme.appearanceDark"] },
  { id: "help", label: "Help", items: [
    "help.welcome", "help.markdownReference", "help.shortcuts", "-", "app.install", "help.storage", "-", "help.about",
  ] },
];
