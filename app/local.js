// Items saved on this device by the earlier, device-only version of the app (IndexedDB).
// Settings can move them into the household.
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

export const localItems = async () => ((await run("readonly", (s) => s.getAll())) || []).map(migrate);
export const deleteLocalItem = (id) => run("readwrite", (s) => s.delete(id));
