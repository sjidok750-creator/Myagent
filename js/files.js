/**
 * 첨부파일 보관소 — IndexedDB.
 *
 * 헤뤼싀가 만든 엑셀·PPT·PDF 는 localStorage 에 넣기엔 크다.
 * 파일 본체는 IndexedDB 에, 대화 메시지에는 참조(id·이름·크기)만 남긴다.
 */

const DB_NAME = 'herushi-files';
const STORE = 'files';
const VERSION = 1;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('이 브라우저는 파일 보관을 지원하지 않습니다.'));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('at', 'at');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let out;
        try {
          out = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = () => resolve(out?.result ?? out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

function b64ToBlob(base64, mime) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

/**
 * 서버가 보낸 파일을 보관하고 참조를 돌려준다.
 * @returns {Promise<{id:string, name:string, mime:string, size:number}>}
 */
export async function saveFile({ name, mime, size, data }) {
  const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const blob = b64ToBlob(data, mime);
  await tx('readwrite', (store) => store.put({ id, at: Date.now(), name, mime, blob }));
  await pruneIfNeeded();
  return { id, name, mime, size: size || blob.size };
}

export async function getBlob(id) {
  const rec = await tx('readonly', (store) => store.get(id));
  return rec?.blob || null;
}

export async function deleteFile(id) {
  forgetObjectUrl(id);
  await tx('readwrite', (store) => store.delete(id));
}

export async function clearFiles() {
  await tx('readwrite', (store) => store.clear());
}

/** 보관 용량이 넘치면 오래된 것부터 지운다. */
async function pruneIfNeeded() {
  const all = await tx('readonly', (store) => store.getAll());
  const list = (all || []).sort((a, b) => a.at - b.at);
  let total = list.reduce((n, r) => n + (r.blob?.size || 0), 0);
  const doomed = [];
  for (const rec of list) {
    if (total <= MAX_TOTAL_BYTES) break;
    doomed.push(rec.id);
    total -= rec.blob?.size || 0;
  }
  if (doomed.length) {
    await tx('readwrite', (store) => doomed.forEach((id) => store.delete(id)));
  }
}

/**
 * 파일의 Blob URL 을 만들어 둔다.
 *
 * 첨부 카드는 스크립트로 흉내 낸 클릭이 아니라 진짜 <a download> 다.
 * 아이폰에서 링크를 탭하면 시스템 공유 시트가 떠서 "파일에 저장"·"메일로 보내기"
 * 를 그대로 쓸 수 있다. 그러려면 탭하는 순간 href 가 이미 있어야 하므로
 * 카드를 그릴 때 미리 URL 을 만들어 둔다. 같은 파일은 한 번만 만든다.
 */
const urlCache = new Map();

export function objectUrlFor(ref) {
  if (urlCache.has(ref.id)) return urlCache.get(ref.id);
  const p = getBlob(ref.id).then((blob) => {
    if (!blob) throw new Error('파일이 더 이상 남아 있지 않습니다.');
    return URL.createObjectURL(blob);
  });
  urlCache.set(ref.id, p);
  p.catch(() => urlCache.delete(ref.id));
  return p;
}

export function forgetObjectUrl(id) {
  const p = urlCache.get(id);
  urlCache.delete(id);
  p?.then((url) => URL.revokeObjectURL(url)).catch(() => {});
}

export function humanSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const ICONS = {
  xlsx: '📊', xls: '📊', csv: '📊',
  docx: '📄', doc: '📄', txt: '📄', md: '📄',
  pptx: '📽️', ppt: '📽️',
  pdf: '📕',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
  zip: '🗜️', json: '🧾',
};

export function fileIcon(name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  return ICONS[ext] || '📎';
}
