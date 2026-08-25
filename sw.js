// Offline support. Shipping containers rarely have good reception, so the app
// itself is cached up front and the heavy vision libraries are cached the first
// time you use them.
const VERSION = 'st-v6';
const SHELL = 'shell-' + VERSION;
const VENDOR = 'vendor-' + VERSION;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/ui.js',
  './js/db.js',
  './js/store.js',
  './js/search.js',
  './js/photos.js',
  './js/vision.js',
  './js/voice.js',
  './js/onedrive.js',
  './js/sync.js',
  './js/box-view.js',
  './js/views.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL && k !== VENDOR).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

const isVendor = (url) =>
  url.hostname === 'cdn.jsdelivr.net' ||
  url.hostname === 'storage.googleapis.com' ||
  url.hostname === 'tfhub.dev' ||
  url.hostname === 'www.kaggle.com';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Microsoft: tokens and uploads must always hit the network.
  if (url.hostname.endsWith('microsoftonline.com') || url.hostname.endsWith('graph.microsoft.com')) return;

  // Tesseract / TensorFlow assets: cache once, then serve locally forever.
  if (isVendor(url)) {
    e.respondWith(
      caches.open(VENDOR).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // App shell: cache first, refresh in the background.
  e.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => hit || cache.match('./index.html'));
      return hit || network;
    })
  );
});
