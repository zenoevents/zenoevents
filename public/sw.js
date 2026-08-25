/* Minimal service worker — required for PWA installability.
   Network-first for navigations (always fresh accounting data), with a cached
   shell fallback when offline. Static assets are cache-first. */
const CACHE = "zeno-v2";
const SHELL = ["/"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API / auth / server-action traffic
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/auth")) return;

  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request).catch(() => caches.match("/").then((r) => r || Response.error()))
    );
    return;
  }

  // Static assets: cache-first
  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/app-icon")) {
    e.respondWith(
      caches.match(request).then((cached) =>
        cached ||
        fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
      )
    );
  }
});
