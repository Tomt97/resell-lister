// Items (with their photos) are stored in this browser's IndexedDB.
import { migrate } from "./model.js";

const DB_NAME = "resell-lister";
const STORE = "items";

let dbPromise;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const allItems = async () => ((await run("readonly", (s) => s.getAll())) || []).map(migrate);
export const getItem = async (id) => migrate(await run("readonly", (s) => s.get(id)));
export const putItem = (item, { touch = true } = {}) =>
  run("readwrite", (s) => s.put(touch ? { ...item, updatedAt: Date.now() } : item));
export const deleteItem = (id) => run("readwrite", (s) => s.delete(id));

// Pages with unsaved edits register here; the router waits for them before showing the next page.
const pending = new Set();
export const onBeforeLeave = (fn) => { pending.add(fn); return () => pending.delete(fn); };
export async function flushPending() {
  const fns = [...pending];
  pending.clear();
  await Promise.all(fns.map((fn) => fn()));
}
