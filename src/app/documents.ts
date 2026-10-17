// Open documents: where each one lives, its saved/current text, and session
// persistence (open documents and unsaved drafts survive reloads and crashes).
import { kv } from "../storage/idb";
import { type Workspace, libraryWorkspace, FolderWorkspace, savedFolders, ensurePermission } from "../storage/workspace";
import { basename, dirname, join, stem, extname } from "../storage/paths";
import type { EditorState } from "@codemirror/state";

export type DocLocation =
  | { kind: "workspace"; workspaceId: string; path: string }
  | { kind: "handle"; handle: FileSystemFileHandle }
  | { kind: "untitled" };

export interface Doc {
  id: string;
  name: string;
  location: DocLocation;
  savedText: string;
  text: string;
  bom: boolean;
  crlf: boolean;
  diskMtime?: number;
  state?: EditorState;
  scrollTop?: number;
  /** Folder permission must be re-granted before this document can load. */
  pendingPermission?: boolean;
  loaded: boolean;
}

interface SessionDoc { id: string; name: string; location: DocLocation; draft?: string; savedText?: string; bom?: boolean; crlf?: boolean }
interface Session { docs: SessionDoc[]; activeId: string | null; workspaceId: string }

export function decodeText(raw: string) {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const crlf = /\r\n/.test(body.slice(0, 10000));
  return { text: body.replace(/\r\n?/g, "\n"), bom, crlf };
}

export function encodeText(doc: Pick<Doc, "text" | "bom" | "crlf">) {
  const body = doc.crlf ? doc.text.replace(/\n/g, "\r\n") : doc.text;
  return (doc.bom ? "﻿" : "") + body;
}

export class Documents {
  docs: Doc[] = [];
  activeId: string | null = null;
  workspaces = new Map<string, Workspace>([[libraryWorkspace.id, libraryWorkspace]]);
  private persistTimer = 0;
  private untitledCounter = 0;

  get active() { return this.docs.find(doc => doc.id === this.activeId) ?? null; }
  isDirty(doc: Doc) { return doc.text !== doc.savedText || doc.location.kind === "untitled" && doc.text.length > 0; }

  workspaceOf(doc: Doc): Workspace | null {
    return doc.location.kind === "workspace" ? this.workspaces.get(doc.location.workspaceId) ?? null : null;
  }

  findOpen(location: DocLocation) {
    return this.docs.find(doc => sameLocation(doc.location, location)) ?? null;
  }

  createUntitled(text = ""): Doc {
    this.untitledCounter++;
    const doc: Doc = { id: crypto.randomUUID(), name: `Untitled-${this.untitledCounter}`, location: { kind: "untitled" }, savedText: "", text, bom: false, crlf: false, loaded: true };
    this.docs.push(doc);
    this.schedulePersist();
    return doc;
  }

  async openLocation(location: DocLocation): Promise<Doc> {
    const existing = this.findOpen(location);
    if (existing) return existing;
    const doc: Doc = { id: crypto.randomUUID(), name: nameOf(location), location, savedText: "", text: "", bom: false, crlf: false, loaded: false };
    await this.load(doc);
    this.docs.push(doc);
    this.schedulePersist();
    return doc;
  }

  async load(doc: Doc) {
    const { raw, mtime } = await this.readRaw(doc.location);
    const decoded = decodeText(raw);
    doc.savedText = decoded.text;
    doc.text = decoded.text;
    doc.bom = decoded.bom;
    doc.crlf = decoded.crlf;
    doc.diskMtime = mtime;
    doc.loaded = true;
    doc.pendingPermission = false;
    doc.state = undefined;
  }

  async readRaw(location: DocLocation): Promise<{ raw: string; mtime?: number }> {
    if (location.kind === "workspace") {
      const workspace = this.workspaces.get(location.workspaceId);
      if (!workspace) throw new Error("The folder for this document is not open.");
      const raw = await workspace.readText(location.path);
      return { raw, mtime: (await workspace.stat(location.path))?.mtime };
    }
    if (location.kind === "handle") {
      const file = await location.handle.getFile();
      return { raw: await file.text(), mtime: file.lastModified };
    }
    return { raw: "" };
  }

  /** Write the document to where it lives. Untitled documents need a location first. */
  async save(doc: Doc) {
    const data = encodeText(doc);
    const text = doc.text;
    if (doc.location.kind === "workspace") {
      const workspace = this.workspaces.get(doc.location.workspaceId);
      if (!workspace) throw new Error("The folder for this document is not open.");
      await workspace.writeText(doc.location.path, data);
      doc.diskMtime = (await workspace.stat(doc.location.path))?.mtime;
    } else if (doc.location.kind === "handle") {
      if (!(await ensurePermission(doc.location.handle, true))) throw new Error("Permission to write the file was denied.");
      const writable = await doc.location.handle.createWritable();
      await writable.write(new Blob([data], { type: "text/markdown" }));
      await writable.close();
      doc.diskMtime = (await doc.location.handle.getFile()).lastModified;
    } else throw new Error("Choose where to save this document first.");
    doc.savedText = text;
    this.schedulePersist();
  }

  async saveTo(doc: Doc, location: DocLocation) {
    const previous = doc.location;
    doc.location = location;
    doc.name = nameOf(location);
    try { await this.save(doc); } catch (error) { doc.location = previous; doc.name = nameOf(previous); throw error; }
  }

  /** Change in disk state since we last read/wrote it (for folder and handle files). */
  async externalChange(doc: Doc): Promise<boolean> {
    if (doc.diskMtime === undefined || doc.location.kind === "untitled") return false;
    try {
      if (doc.location.kind === "workspace") {
        const stat = await this.workspaces.get(doc.location.workspaceId)?.stat(doc.location.path);
        return !!stat && stat.mtime !== doc.diskMtime && doc.location.workspaceId !== "library";
      }
      const file = await doc.location.handle.getFile();
      return file.lastModified !== doc.diskMtime;
    } catch { return false; }
  }

  close(doc: Doc) {
    this.docs = this.docs.filter(item => item !== doc);
    if (this.activeId === doc.id) this.activeId = this.docs.at(-1)?.id ?? null;
    this.schedulePersist();
  }

  /** Keep open documents pointing at renamed/moved files. */
  renamed(workspaceId: string, from: string, to: string) {
    for (const doc of this.docs) {
      if (doc.location.kind !== "workspace" || doc.location.workspaceId !== workspaceId) continue;
      const path = doc.location.path;
      if (path === from || path.startsWith(from + "/")) {
        doc.location = { kind: "workspace", workspaceId, path: to + path.slice(from.length) };
        doc.name = basename(doc.location.path);
      }
    }
    this.schedulePersist();
  }

  async uniquePath(workspace: Workspace, directory: string, name: string) {
    const extension = extname(name) || ".md";
    const base = stem(name) || "Untitled";
    let candidate = join(directory, base + extension);
    for (let i = 2; await workspace.exists(candidate); i++) candidate = join(directory, `${base} ${i}${extension}`);
    return candidate;
  }

  schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => void this.persist(), 400);
  }

  async persist(workspaceId = "library") {
    const session: Session = {
      activeId: this.activeId,
      workspaceId: this.currentWorkspaceId ?? workspaceId,
      docs: this.docs.filter(doc => doc.loaded || doc.pendingPermission).map(doc => ({
        id: doc.id, name: doc.name, location: doc.location, bom: doc.bom, crlf: doc.crlf,
        draft: this.isDirty(doc) ? doc.text : undefined,
        savedText: this.isDirty(doc) ? doc.savedText : undefined,
      })),
    };
    try { await kv.set("session", session); } catch { /* storage full or unavailable */ }
  }

  currentWorkspaceId: string | null = null;

  async restore(): Promise<{ workspaceId: string } | null> {
    const session = await kv.get<Session>("session");
    if (!session) return null;
    for (const folder of await savedFolders()) this.workspaces.set(folder.id, new FolderWorkspace(folder.id, folder.handle));
    for (const entry of session.docs) {
      const doc: Doc = { id: entry.id, name: entry.name, location: entry.location, savedText: entry.savedText ?? "", text: entry.draft ?? "", bom: !!entry.bom, crlf: !!entry.crlf, loaded: false };
      if (entry.location.kind === "untitled") {
        const match = /^Untitled-(\d+)$/.exec(entry.name);
        if (match) this.untitledCounter = Math.max(this.untitledCounter, Number(match[1]));
        doc.loaded = true;
        doc.savedText = "";
        if (!entry.draft) continue;
      } else {
        try {
          const handle = entry.location.kind === "handle" ? entry.location.handle : (this.workspaces.get(entry.location.workspaceId) as FolderWorkspace | undefined)?.handle;
          if (entry.location.kind === "workspace" && entry.location.workspaceId !== "library" && !handle) continue;
          if (handle && !(await ensurePermission(handle, false))) {
            doc.pendingPermission = true;
          } else {
            const draft = entry.draft;
            await this.load(doc);
            if (draft !== undefined && draft !== doc.text) doc.text = draft;
          }
        } catch {
          if (entry.draft === undefined) continue;
          doc.loaded = true;
          doc.location = { kind: "untitled" };
        }
      }
      this.docs.push(doc);
    }
    this.activeId = this.docs.some(doc => doc.id === session.activeId) ? session.activeId : this.docs.at(-1)?.id ?? null;
    return { workspaceId: session.workspaceId };
  }

  /** Re-request folder/file permission (needs a user gesture) and load pending docs. */
  async grantPending() {
    let granted = 0;
    for (const doc of this.docs.filter(item => item.pendingPermission)) {
      const handle = doc.location.kind === "handle" ? doc.location.handle : (this.workspaceOf(doc) as FolderWorkspace | null)?.handle;
      if (!handle || !(await ensurePermission(handle, true))) continue;
      const draft = doc.text;
      await this.load(doc);
      if (draft && draft !== doc.text) doc.text = draft;
      granted++;
    }
    return granted;
  }
}

export function nameOf(location: DocLocation) {
  if (location.kind === "workspace") return basename(location.path);
  if (location.kind === "handle") return location.handle.name;
  return "Untitled";
}

export function sameLocation(a: DocLocation, b: DocLocation) {
  if (a.kind === "workspace" && b.kind === "workspace") return a.workspaceId === b.workspaceId && a.path === b.path;
  if (a.kind === "handle" && b.kind === "handle") return a.handle === b.handle;
  return false;
}

export function docDirectory(doc: Doc) {
  return doc.location.kind === "workspace" ? dirname(doc.location.path) : "";
}
