// POSIX-style path helpers for workspace-relative paths ("notes/a.md").
export function normalize(path: string) {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop(); else out.push(part);
  }
  return out.join("/");
}
export const join = (...parts: string[]) => normalize(parts.filter(Boolean).join("/"));
export const dirname = (path: string) => { const n = normalize(path); const i = n.lastIndexOf("/"); return i < 0 ? "" : n.slice(0, i); };
export const basename = (path: string) => { const n = normalize(path); return n.slice(n.lastIndexOf("/") + 1); };
export const extname = (path: string) => { const b = basename(path); const i = b.lastIndexOf("."); return i <= 0 ? "" : b.slice(i).toLowerCase(); };
export const stem = (path: string) => { const b = basename(path); const e = extname(b); return e ? b.slice(0, -e.length) : b; };
export const isMarkdown = (path: string) => [".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".mdwn", ".txt", ".text"].includes(extname(path));
export const isImage = (path: string) => [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico"].includes(extname(path));
/** Path of `target` relative to directory `from` (both workspace-relative). */
export function relative(from: string, target: string) {
  const a = normalize(from).split("/").filter(Boolean), b = normalize(target).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/") || ".";
}
export function encodePath(path: string) {
  return path.split("/").map(part => /[\s()<>]/.test(part) ? encodeURIComponent(part) : part).join("/");
}
