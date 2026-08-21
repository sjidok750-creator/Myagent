/* 헤뤼싀 서비스워커 — 껍데기는 캐시하고, 대화 요청은 절대 캐시하지 않는다. */

const CACHE = 'herushi-shell-v2';
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
