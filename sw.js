// Have Less, Live More — app helper (service worker)
// Pages: always try the internet first so guests see the latest version;
// if there's no signal, show the last saved copy.
// Images, icons and fonts: use the saved copy for speed.
// To force every phone to refresh everything, change the version number below.
const VERSION = 'hllm-v2';
const CORE = ['/', '/index.html', '/contact.html', '/guide.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // forms go straight to the internet
  const url = new URL(req.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !fonts) return; // maps, Instagram, Formspree, analytics: untouched
  if (/\.(mp4|pdf)$/i.test(url.pathname)) return;           // videos & PDFs: too big to store
  if (url.pathname.endsWith('availability.json')) return;   // calendar must always be live

  if (req.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
