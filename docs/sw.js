const CACHE_PREFIX = 'still-whitenoise-';
const CACHE_NAME = `${CACHE_PREFIX}v12`;
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './audio-engine.js', './manifest.webmanifest',
  './images/favicon.svg', './images/fan.svg', './images/rain.svg', './images/white-noise.svg', './images/brown-noise.svg',
  './images/app-icon-192.png', './images/app-icon-512.png', './images/apple-touch-icon.png',
  './audio/box-fan.wav', './audio/rain.wav', './audio/white-noise.wav', './audio/brown-noise.wav', './audio/LICENSE.txt',
];
const assetURLs = ASSETS.map(path => new URL(path, self.registration.scope).href);
let offlineRepair;

async function checkOffline(cache) {
  const matches = await Promise.all(assetURLs.map(url => cache.match(url)));
  return { ready: matches.every(Boolean), missing: assetURLs.filter((_, index) => !matches[index]) };
}

function ensureOffline() {
  // Concurrent tabs share a repair; only missing app assets are downloaded.
  if (!offlineRepair) offlineRepair = (async () => {
    const cache = await caches.open(CACHE_NAME);
    const { missing } = await checkOffline(cache);
    if (missing.length) await cache.addAll(missing);
    return (await checkOffline(cache)).ready;
  })().catch(() => false).finally(() => { offlineRepair = null; });
  return offlineRepair;
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(assetURLs)));
  // Updates stay waiting while the existing app is in use; no overnight reloads.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'CHECK_OFFLINE') event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    event.ports?.[0]?.postMessage({ ready: (await checkOffline(cache)).ready });
  })());
  if (event.data?.type === 'ENSURE_OFFLINE') event.waitUntil((async () => {
    event.ports?.[0]?.postMessage({ ready: await ensureOffline() });
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try { return await fetch(request); }
    catch (error) {
      if (request.mode === 'navigate') return cache.match(new URL('./index.html', self.registration.scope));
      throw error;
    }
  })());
});
