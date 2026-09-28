// Tiny IndexedDB key-value layer. Everything the app knows about the user lives here,
// on-device. Writes are queued in order so a crash never reorders the event log.
const DB_NAME = 'hifdh';
const STORE = 'kv';
let dbPromise;
let chain = Promise.resolve();

// A reload can race the previous page's closing connection and leave the first open()
// pending indefinitely, so each attempt times out and is retried.
function attempt(timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    const timer = setTimeout(() => reject(new Error('Opening local storage timed out')), timeoutMs);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
  });
}

async function openWithRetry() {
  for (let i = 0; ; i++) {
    try { return await attempt(1500 + i * 1000); }
    catch (error) { if (i >= 4) throw error; }
  }
}

function open() {
  dbPromise ??= openWithRetry().catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export async function loadAll() {
  const out = {};
  await tx('readonly', store => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      out[cursor.key] = cursor.value;
      cursor.continue();
    };
  });
  return out;
}

export function put(key, value) {
  chain = chain.then(() => tx('readwrite', s => s.put(value, key))).catch(error => console.error('Save failed', key, error));
  return chain;
}

/** Many puts/deletes in one transaction (a sync page, a session's events). */
export function writeMany(puts, deletes = []) {
  if (!puts.length && !deletes.length) return chain;
  chain = chain.then(() => tx('readwrite', s => {
    for (const [key, value] of puts) s.put(value, key);
    for (const key of deletes) s.delete(key);
  })).catch(error => console.error('Save failed', error));
  return chain;
}

export function remove(key) {
  chain = chain.then(() => tx('readwrite', s => s.delete(key))).catch(error => console.error('Delete failed', key, error));
  return chain;
}

export function clearAll() {
  chain = chain.then(() => tx('readwrite', s => s.clear()));
  return chain;
}

export const flush = () => chain;

export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
