const CACHE_NAME = 'free-code-v1';
const PRECACHE_URLS = ['/', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
  } else if (/\.(js|css|woff2?|png|svg|ico|json)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) { const c = await caches.open(CACHE_NAME); c.put(request, res.clone()); }
    return res;
  } catch { return new Response('Offline', { status: 503 }); }
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) { const c = await caches.open(CACHE_NAME); c.put(request, res.clone()); }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return caches.match('/');
    return new Response('Offline', { status: 503 });
  }
}
