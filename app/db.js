// Items (with their photos) are stored in this browser's IndexedDB.
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

export const allItems = async () =>
  ((await run("readonly", (s) => s.getAll())) || []).sort((a, b) => b.updatedAt - a.updatedAt);
export const getItem = (id) => run("readonly", (s) => s.get(id));
export const putItem = (item) => run("readwrite", (s) => s.put({ ...item, updatedAt: Date.now() }));
export const deleteItem = (id) => run("readwrite", (s) => s.delete(id));
