// Workspaces are where documents live: the built-in Library (IndexedDB, works
// everywhere including iPadOS) or a real folder on disk (File System Access
// API, Chromium-based browsers and installed PWAs).
import { library, kv, type LibraryRecord } from "./idb";
import { normalize, dirname, basename, join, isMarkdown, isImage } from "./paths";

export interface Entry { name: string; path: string; kind: "file" | "directory"; mtime?: number; ctime?: number; size?: number; children?: Entry[] }

export interface Workspace {
  readonly id: string;
  readonly kind: "library" | "folder";
  name: string;
  tree(): Promise<Entry>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  readBlob(path: string): Promise<Blob | null>;
  writeBlob(path: string, blob: Blob): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ mtime: number; size: number } | null>;
  createFolder(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const sortEntries = (entries: Entry[]) => entries.sort((a, b) =>
  a.kind !== b.kind ? (a.kind === "directory" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

/* ---------- Library (IndexedDB) ---------- */

export class LibraryWorkspace implements Workspace {
  readonly id = "library";
  readonly kind = "library" as const;
  name = "Library";

  async tree(): Promise<Entry> {
    const records = await library.all();
    const root: Entry = { name: this.name, path: "", kind: "directory", children: [] };
    const dirs = new Map<string, Entry>([["", root]]);
    const ensureDir = (path: string): Entry => {
      const existing = dirs.get(path);
      if (existing) return existing;
      const entry: Entry = { name: basename(path), path, kind: "directory", children: [] };
      dirs.set(path, entry);
      ensureDir(dirname(path)).children!.push(entry);
      return entry;
    };
    for (const record of records) {
      if (record.kind === "directory") { ensureDir(record.path); continue; }
      const size = typeof record.content === "string" ? record.content.length : record.content?.size ?? 0;
      ensureDir(dirname(record.path)).children!.push({ name: basename(record.path), path: record.path, kind: "file", mtime: record.mtime, ctime: record.ctime, size });
    }
    for (const dir of dirs.values()) sortEntries(dir.children!);
    return root;
  }
  async readText(path: string) {
    const record = await library.get(normalize(path));
    if (!record || record.kind !== "file") throw new Error(`File not found: ${path}`);
    return typeof record.content === "string" ? record.content : await (record.content as Blob).text();
  }
  async writeText(path: string, text: string) {
    const key = normalize(path);
    const existing = await library.get(key);
    const now = Date.now();
    await library.put({ path: key, kind: "file", content: text, mtime: now, ctime: existing?.ctime ?? now });
  }
  async readBlob(path: string) {
    const record = await library.get(normalize(path));
    if (!record || record.kind !== "file") return null;
    return record.content instanceof Blob ? record.content : new Blob([record.content ?? ""]);
  }
  async writeBlob(path: string, blob: Blob) {
    const key = normalize(path);
    const now = Date.now();
    await library.put({ path: key, kind: "file", content: blob, mtime: now, ctime: now });
  }
  async exists(path: string) { return !!(await library.get(normalize(path))) || (await library.all()).some(r => r.path.startsWith(normalize(path) + "/")); }
  async stat(path: string) {
    const record = await library.get(normalize(path));
    if (!record) return null;
    return { mtime: record.mtime, size: typeof record.content === "string" ? record.content.length : record.content?.size ?? 0 };
  }
  async createFolder(path: string) {
    const now = Date.now();
    await library.put({ path: normalize(path), kind: "directory", mtime: now, ctime: now });
  }
  async rename(from: string, to: string) {
    const source = normalize(from), target = normalize(to);
    if (await library.get(target)) throw new Error(`“${basename(target)}” already exists.`);
    const records = await library.all();
    for (const record of records) {
      if (record.path === source || record.path.startsWith(source + "/")) {
        await library.delete(record.path);
        await library.put({ ...record, path: target + record.path.slice(source.length) } as LibraryRecord);
      }
    }
  }
  async remove(path: string) {
    const key = normalize(path);
    for (const record of await library.all()) if (record.path === key || record.path.startsWith(key + "/")) await library.delete(record.path);
  }
}

/* ---------- Folder on disk (File System Access API) ---------- */

export const folderAccessSupported = typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
export const fileAccessSupported = typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === "function";

type PermissionHandle = FileSystemHandle & {
  queryPermission?(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  move?(parent: FileSystemDirectoryHandle | string, name?: string): Promise<void>;
};

export async function ensurePermission(handle: FileSystemHandle, request: boolean) {
  const h = handle as PermissionHandle;
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  if (!request || !h.requestPermission) return false;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

const skipDirs = new Set([".git", "node_modules", ".obsidian", ".trash", ".Trash", "__pycache__", ".DS_Store"]);

export class FolderWorkspace implements Workspace {
  readonly kind = "folder" as const;
  name: string;
  constructor(readonly id: string, readonly handle: FileSystemDirectoryHandle) { this.name = handle.name; }

  private async dir(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let dir = this.handle;
    for (const part of normalize(path).split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }
  private async file(path: string, create = false): Promise<FileSystemFileHandle> {
    const dir = await this.dir(dirname(path), create);
    return dir.getFileHandle(basename(path), { create });
  }

  async tree(): Promise<Entry> {
    let budget = 5000;
    const walk = async (dir: FileSystemDirectoryHandle, path: string, depth: number): Promise<Entry> => {
      const entry: Entry = { name: path ? basename(path) : this.name, path, kind: "directory", children: [] };
      if (depth > 10) return entry;
      for await (const [name, child] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (--budget < 0) break;
        if (name.startsWith(".") && child.kind === "directory") continue;
        if (skipDirs.has(name)) continue;
        const childPath = join(path, name);
        if (child.kind === "directory") entry.children!.push(await walk(child as FileSystemDirectoryHandle, childPath, depth + 1));
        else if (isMarkdown(name) || isImage(name)) {
          let mtime: number | undefined, size: number | undefined;
          if (isMarkdown(name)) { try { const file = await (child as FileSystemFileHandle).getFile(); mtime = file.lastModified; size = file.size; } catch { /* unreadable */ } }
          entry.children!.push({ name, path: childPath, kind: "file", mtime, size });
        }
      }
      sortEntries(entry.children!);
      return entry;
    };
    return walk(this.handle, "", 0);
  }
  async readText(path: string) { return (await (await this.file(path)).getFile()).text(); }
  async writeText(path: string, text: string) { await this.writeBlob(path, new Blob([text], { type: "text/markdown" })); }
  async readBlob(path: string) { try { return await (await this.file(path)).getFile(); } catch { return null; } }
  async writeBlob(path: string, blob: Blob) {
    const handle = await this.file(path, true);
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }
  async exists(path: string) {
    try { await this.file(path); return true; } catch {
      try { await this.dir(path); return true; } catch { return false; }
    }
  }
  async stat(path: string) {
    try { const file = await (await this.file(path)).getFile(); return { mtime: file.lastModified, size: file.size }; } catch { return null; }
  }
  async createFolder(path: string) { await this.dir(path, true); }
  async rename(from: string, to: string) {
    if (await this.exists(to)) throw new Error(`“${basename(to)}” already exists.`);
    let handle: PermissionHandle;
    try { handle = await this.file(from) as PermissionHandle; } catch { handle = await this.dir(from) as PermissionHandle; }
    if (handle.move) {
      const sameDir = dirname(from) === dirname(to);
      if (sameDir) await handle.move(basename(to));
      else await handle.move(await this.dir(dirname(to), true), basename(to));
      return;
    }
    if (handle.kind !== "file") throw new Error("Renaming folders is not supported by this browser.");
    await this.writeBlob(to, await (handle as unknown as FileSystemFileHandle).getFile());
    await this.remove(from);
  }
  async remove(path: string) {
    const dir = await this.dir(dirname(path));
    await dir.removeEntry(basename(path), { recursive: true });
  }
}

/* ---------- Registry ---------- */

export const libraryWorkspace = new LibraryWorkspace();

export async function savedFolders(): Promise<{ id: string; handle: FileSystemDirectoryHandle }[]> {
  return (await kv.get<{ id: string; handle: FileSystemDirectoryHandle }[]>("folders")) ?? [];
}

export async function rememberFolder(handle: FileSystemDirectoryHandle): Promise<FolderWorkspace> {
  const folders = await savedFolders();
  for (const folder of folders) {
    if (await (folder.handle as unknown as { isSameEntry(other: FileSystemHandle): Promise<boolean> }).isSameEntry(handle)) return new FolderWorkspace(folder.id, folder.handle);
  }
  const id = "folder-" + crypto.randomUUID();
  folders.unshift({ id, handle });
  await kv.set("folders", folders.slice(0, 12));
  return new FolderWorkspace(id, handle);
}

export async function forgetFolder(id: string) {
  await kv.set("folders", (await savedFolders()).filter(folder => folder.id !== id));
}
