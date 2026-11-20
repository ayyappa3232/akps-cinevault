/**
 * service-worker.js — offline support.
 *
 * Strategy: NETWORK FIRST, cache as fallback. You always get your latest edits to
 * movies.js while online, and the app still opens offline.
 *
 * IMPORTANT: bump CACHE_VERSION on every deploy so old caches are deleted.
 */
const CACHE_VERSION = "cinevault-v4";
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "movies.js",
  "app.js",
  "ui-select.js",
  "storage.js",
  "recommendations.js",
  "tmdb.js",
  "manifest.json",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

// The page asks the waiting worker to take over (see "Update ready" toast in app.js).
self.addEventListener("message", (event) => {
  if (event.data === "skip") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  const isWebRequest = /^https?:$/.test(url.protocol);
  const isNeverCached =
    url.hostname.includes("youtube") ||
    url.hostname.includes("ytimg") ||
    url.hostname === "api.themoviedb.org";
  if (!isWebRequest || isNeverCached) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("index.html"))),
  );
});
