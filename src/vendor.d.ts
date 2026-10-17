declare module "markdown-it-footnote";
declare module "markdown-it-mark";
declare module "markdown-it-sub";
declare module "markdown-it-sup";
declare module "markdown-it-task-lists";
declare module "markdown-it-emoji" { export const full: unknown; export const light: unknown; export const bare: unknown; }
declare module "markdown-it-emoji/lib/data/full.mjs" { const data: Record<string, string>; export default data; }
declare module "turndown-plugin-gfm" { export const gfm: unknown; export const tables: unknown; export const strikethrough: unknown; }
declare module "@mathjax/src/mjs/*";
declare module "@mathjax/mathjax-newcm-font/js/svg.js" { export class MathJaxNewcmFont { constructor(options?: unknown); } }
