// Service worker: keeps the app and reading list usable with no signal.
//   app shell + content JSON: network first, cached copy when offline
//   Google Fonts: cache first
//   /api/*: never cached (sync handles offline itself)
const VERSION = 'tn-v7';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/logic.js', '/setup.js', '/sync.js', '/manifest.webmanifest', '/icons/icon.svg', '/content/index.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    // Only cache real same-origin pages; an Access login redirect must never be stored.
    if (res.ok && res.type === 'basic' && !res.redirected) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await cache.match('/index.html')) || Response.error();
    return Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return;
    e.respondWith(networkFirst(e.request));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(e.request));
  }
});
