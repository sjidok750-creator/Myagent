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

/* ------------------------------------------------------------------ *
 * 대표님이 보내는 첨부 (사진·PDF·문서)
 * ------------------------------------------------------------------ */

const MAX_ATTACH_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1568; // Anthropic 권장 최대 변. 더 크면 토큰만 낭비된다.

/** 첨부를 성격별로 나눈다. 서버가 이걸 보고 어떤 블록으로 넣을지 정한다. */
export function attachKind(mime, name = '') {
  const m = String(mime || '').toLowerCase();
  const ext = String(name).split('.').pop()?.toLowerCase() || '';
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('text/') || ['txt', 'md', 'csv', 'tsv', 'json', 'log', 'xml', 'yml', 'yaml'].includes(ext)) {
    return 'text';
  }
  return 'data'; // 엑셀·워드·PPT 등 — 코드 실행으로 열어 본다
}

/**
 * 고른 파일을 첨부로 만든다. 사진은 미리 줄여서 담는다.
 * @returns {Promise<{id, name, mime, size, kind, thumb?:string}>}
 */
export async function makeAttachment(file) {
  if (!file) throw new Error('파일이 없습니다.');
  if (file.size > MAX_ATTACH_BYTES) {
    throw new Error(`${humanSize(file.size)} 는 너무 큽니다. 20MB 까지 보낼 수 있습니다.`);
  }

  const kind = attachKind(file.type, file.name);
  let blob = file;
  let mime = file.type || 'application/octet-stream';
  let thumb;

  if (kind === 'image') {
    const shrunk = await shrinkImage(file);
    if (shrunk) {
      blob = shrunk.blob;
      mime = shrunk.mime;
      thumb = shrunk.thumb;
    }
  }

  const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await tx('readwrite', (store) =>
    store.put({ id, at: Date.now(), name: file.name || '첨부', mime, blob })
  );
  await pruneIfNeeded();

  return { id, name: file.name || '첨부', mime, size: blob.size, kind, thumb };
}

/** 사진을 긴 변 1568px 로 줄이고 작은 미리보기를 만든다. */
async function shrinkImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(bmp, 0, 0, w, h);

    // 미리보기 (작성창·말풍선용)
    const tc = document.createElement('canvas');
    const ts = Math.min(1, 320 / Math.max(w, h));
    tc.width = Math.max(1, Math.round(w * ts));
    tc.height = Math.max(1, Math.round(h * ts));
    tc.getContext('2d').drawImage(canvas, 0, 0, tc.width, tc.height);
    const thumb = tc.toDataURL('image/jpeg', 0.7);

    bmp.close?.();

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) return null;
    return { blob, mime: 'image/jpeg', thumb };
  } catch {
    return null; // 줄이지 못하면 원본 그대로 보낸다
  }
}

/** 첨부를 서버로 보낼 형태(base64)로 만든다. 이미 올린 파일은 file_id 만 보낸다. */
export async function attachmentPayload(ref) {
  if (ref.fileId) {
    return { id: ref.id, name: ref.name, mime: ref.mime, kind: ref.kind, fileId: ref.fileId };
  }
  const blob = await getBlob(ref.id);
  if (!blob) return null;
  return {
    id: ref.id,
    name: ref.name,
    mime: ref.mime,
    kind: ref.kind,
    data: await blobToBase64(blob),
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
