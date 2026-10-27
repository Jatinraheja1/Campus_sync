// Minimal offline cache: remembers the app shell, built assets and face models after the first online visit.
const CACHE = "smartattend-v3";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never touch backend/API calls

  const store = (res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; };

  if (url.pathname.startsWith("/models/") || url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(store)));
    return;
  }
  e.respondWith(
    fetch(req).then(store).catch(async () => (await caches.match(req)) || (req.mode === "navigate" && (await caches.match("/"))) || Response.error())
  );
});
