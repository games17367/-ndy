// Service Worker: macht Ändy installierbar und lädt die Oberfläche auch ohne Netz.
// API-Anfragen (Gespräch, Sprache, Wetter) werden NIE zwischengespeichert.

const VERSION = 'aendy-v1.2.0';
const SHELL = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './css/app.css',
  './fonts/poppins-300.woff',
  './fonts/poppins-400.woff',
  './fonts/poppins-500.woff',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './img/andy.jpg',
  './js/main.js',
  './js/store.js',
  './js/api.js',
  './js/events.js',
  './js/platform.js',
  './js/audio.js',
  './js/speech-in.js',
  './js/speech-out.js',
  './js/voice-profile.js',
  './js/speech-text.js',
  './js/scheduler.js',
  './js/assistant.js',
  './js/core-canvas.js',
  './js/ui.js',
  './js/icons.js',
  './js/settings-ui.js',
  './js/actions.js',
  './js/wake.js',
  './js/commands.js',
  './js/content.js',
  './js/datetime.js',
  './js/ics.js',
  './js/capabilities.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Fremde Server (z. B. das Backend) nie anfassen
  if (url.pathname.includes('/api/')) return;

  // Stale-while-revalidate: sofort aus dem Cache, im Hintergrund aktualisieren
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});
