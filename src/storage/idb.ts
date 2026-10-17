// Small promise wrapper around IndexedDB: a "library" store for the built-in
// document library and a key/value store for handles, session and settings.
const DB_NAME = "typorium";
const VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("library")) db.createObjectStore("library", { keyPath: "path" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function store(name: "library" | "kv", mode: IDBTransactionMode = "readonly") {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const kv = {
  async get<T>(key: string): Promise<T | undefined> { return wrap((await store("kv")).get(key)) as Promise<T | undefined>; },
  async set(key: string, value: unknown) { await wrap((await store("kv", "readwrite")).put(value, key)); },
  async delete(key: string) { await wrap((await store("kv", "readwrite")).delete(key)); },
  async keys(prefix = ""): Promise<string[]> {
    const keys = await wrap((await store("kv")).getAllKeys()) as string[];
    return keys.filter(key => typeof key === "string" && key.startsWith(prefix));
  },
};

export interface LibraryRecord { path: string; kind: "file" | "directory"; content?: string | Blob; mtime: number; ctime: number }

export const library = {
  async get(path: string) { return wrap((await store("library")).get(path)) as Promise<LibraryRecord | undefined>; },
  async put(record: LibraryRecord) { await wrap((await store("library", "readwrite")).put(record)); },
  async delete(path: string) { await wrap((await store("library", "readwrite")).delete(path)); },
  async all() { return wrap((await store("library")).getAll()) as Promise<LibraryRecord[]>; },
};

export { wrap };
