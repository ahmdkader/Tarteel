const CACHE = "tarteel-shell-v4";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// App shell: cache-first. Quran text/audio API calls: network-first, fall back to cache.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isShell = SHELL.some((p) => url.pathname.endsWith(p.replace("./", "/")));

  if (isShell) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
    return;
  }

  if (url.origin !== self.location.origin) {
    // Quran text / audio from external CDNs: try network, cache a copy, else serve cached copy
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open("tarteel-data-v1").then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
