const C = "mayvex-v1";
const FILES = ["index.html", "customer.html", "seller.html", "common.js", "logo.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(C).then((c) => c.addAll(FILES)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

// Network first, so updates always show. The cache is only a fallback when offline.
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(C).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request))
  );
});