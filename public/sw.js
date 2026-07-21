const CACHE_NAME = "33-pool-production-v30";
const APP_ROOT = new URL("./", self.location).href;
const APP_SHELL = [
  APP_ROOT,
  new URL("manifest.webmanifest", APP_ROOT).href,
  new URL("official-logo.png", APP_ROOT).href,
  new URL("app-icon-192.png", APP_ROOT).href,
  new URL("app-icon-512.png", APP_ROOT).href,
  new URL("maskable-icon-512.png", APP_ROOT).href,
  new URL("apple-touch-icon.png", APP_ROOT).href,
  new URL("favicon-32.png", APP_ROOT).href,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
    self.registration.navigationPreload ? self.registration.navigationPreload.enable() : Promise.resolve(),
  ]));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      const preload = await event.preloadResponse;
      if (preload) {
        const copy = preload.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(APP_ROOT, copy)));
        return preload;
      }
      try {
        const response = await fetch(event.request);
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(APP_ROOT, copy)));
        return response;
      } catch {
        return (await caches.match(APP_ROOT)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
      }
      return response;
    } catch {
      return cached || Response.error();
    }
  })());
});
