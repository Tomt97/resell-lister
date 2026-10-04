// Offline shell. Network first so updates show up on the next open.
const CACHE = "resell-lister-v3";
const SHELL = ["./", "index.html", "styles.css", "app.js", "ai.js", "store.js", "local.js", "pending.js", "config.js", "model.js", "ui.js", "extbridge.js", "views/home.js", "views/inventory.js", "views/item.js", "views/analytics.js", "views/settings.js", "views/auth.js", "views/people.js", "vendor/anthropic-sdk.js", "vendor/firebase.js", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
