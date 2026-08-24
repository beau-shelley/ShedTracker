// IndexedDB layer. One database, four stores, promise wrappers.
const NAME = 'shedtracker';
const VERSION = 1;

let dbp = null;

export function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains('boxes')) {
        const s = db.createObjectStore('boxes', { keyPath: 'id' });
        s.createIndex('number', 'number', { unique: true });
        s.createIndex('locationId', 'locationId');
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('boxId', 'boxId');
      }
      if (!db.objectStoreNames.contains('locations')) {
        db.createObjectStore('locations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const wrap = (req) => req; // request resolved by tx() on complete

export const get      = (store, key)   => tx(store, 'readonly',  s => wrap(s.get(key)));
export const put      = (store, value) => tx(store, 'readwrite', s => wrap(s.put(value)));
export const del      = (store, key)   => tx(store, 'readwrite', s => wrap(s.delete(key)));
export const clear    = (store)        => tx(store, 'readwrite', s => wrap(s.clear()));
export const getAll   = (store)        => tx(store, 'readonly',  s => wrap(s.getAll()));

export const getAllBy = (store, index, value) =>
  tx(store, 'readonly', s => wrap(s.index(index).getAll(value)));

export async function putMany(store, values) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const v of values) s.put(v);
    t.oncomplete = () => resolve(values.length);
    t.onerror = () => reject(t.error);
  });
}

// ---- meta helpers (settings, tokens, sync bookkeeping) ----
export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}
export const setMeta = (key, value) => put('meta', { key, value });
export const delMeta = (key) => del('meta', key);

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function estimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  return navigator.storage.estimate();
}

// Ask the browser to keep our data even under storage pressure.
export async function persist() {
  if (navigator.storage && navigator.storage.persist) {
    if (await navigator.storage.persisted()) return true;
    return navigator.storage.persist();
  }
  return false;
}
