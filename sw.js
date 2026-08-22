/* 헤뤼싀 서비스워커 — 껍데기는 캐시하고, 대화 요청은 절대 캐시하지 않는다. */

const CACHE = 'herushi-shell-v4';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/base.css',
  './styles/list.css',
  './styles/chat.css',
  './js/app.js',
  './js/api.js',
  './js/store.js',
  './js/persona.js',
  './js/departments.js',
  './js/avatar.js',
  './js/icons.js',
  './js/format.js',
  './js/files.js',
  './js/google.js',
  './js/push.js',
  './js/ui/list.js',
  './js/ui/chat.js',
  './js/ui/info.js',
  './js/ui/settings.js',
  './js/ui/vault.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;      // 대화는 항상 네트워크
  if (url.origin !== self.location.origin) return;

  // 네트워크 우선, 실패하면 캐시 (오프라인에서도 앱은 열린다)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});


/* ------------------------------------------------------------------ *
 * 헤뤼싀가 먼저 말을 걸 때
 * ------------------------------------------------------------------ */

const INBOX_DB = 'herushi-files';
const INBOX_STORE = 'inbox';

/** 받은 메시지를 IndexedDB 에 담아 둔다. 앱이 열리면 대화방에 넣는다. */
function stash(payload) {
  return new Promise((resolve) => {
    const req = indexedDB.open(INBOX_DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' }).createIndex('at', 'at');
      }
      if (!db.objectStoreNames.contains(INBOX_STORE)) {
        db.createObjectStore(INBOX_STORE, { keyPath: 'at' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(INBOX_STORE)) return resolve();
      const tx = db.transaction(INBOX_STORE, 'readwrite');
      tx.objectStore(INBOX_STORE).put({
        at: payload.at || Date.now(),
        dept: payload.dept || 'chief',
        text: payload.text || payload.body || '',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    };
    req.onerror = () => resolve();
  });
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: '헤뤼싀', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      await stash(payload);
      // 앱이 열려 있으면 바로 대화에 꽂아 준다
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clientList) c.postMessage({ type: 'herushi-message', payload });

      await self.registration.showNotification(payload.title || '헤뤼싀', {
        body: payload.body || '',
        icon: './assets/icons/icon-192.png',
        badge: './assets/icons/icon-192.png',
        tag: 'herushi-brief',
        renotify: true,
        data: { dept: payload.dept || 'chief' },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const dept = event.notification.data?.dept || 'chief';
  const target = `./#/chat/${dept}`;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clientList) {
        if ('focus' in c) {
          c.postMessage({ type: 'herushi-open', dept });
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })()
  );
});
