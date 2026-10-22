import { emptyState, sanitizeState } from './core.js';
const KEY = 'music-muse-v2';
export function loadState() {
  try { return sanitizeState(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return emptyState(); }
}
export function saveState(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; } }
let dbPromise;
function db() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('הדפדפן אינו תומך בשמירת קבצים מקומית.')); return; }
    const request = indexedDB.open('music-muse-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(new Error('לא ניתן לפתוח את ספריית הקבצים. בדוק הרשאות אחסון בדפדפן.')); };
    request.onblocked = () => { dbPromise = null; reject(new Error('ספריית הקבצים חסומה על ידי לשונית אחרת.')); };
  });
  return dbPromise;
}
async function transaction(mode, action) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('files', mode); const request = action(tx.objectStore('files'));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(new Error('שמירת הקובץ נכשלה. ייתכן שאין מספיק מקום פנוי.'));
    tx.onabort = () => reject(new Error('הפעולה בוטלה ולא נשמרה.'));
  });
}
export const fileStore = {
  put: (id, file) => transaction('readwrite', store => store.put(file, id)),
  get: id => transaction('readonly', store => store.get(id)),
  remove: id => transaction('readwrite', store => store.delete(id)),
  clear: () => transaction('readwrite', store => store.clear()),
  keys: () => transaction('readonly', store => store.getAllKeys())
};
