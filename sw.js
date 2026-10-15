/* =============================================================================
   StudyBoard service worker.
   * App shell is precached so the UI opens instantly and works offline.
   * Supabase API / auth / storage / realtime traffic is NEVER cached — live
     collaboration is online-only by design.
   * Same-origin assets and CDN libraries use stale-while-revalidate.
   ============================================================================= */
const VERSION = "studyboard-v1";
const SHELL = [
  "./", "index.html", "room.html", "offline.html",
  "manifest.webmanifest", "css/styles.css",
  "js/config.js", "js/supabase-client.js", "js/util.js", "js/ui.js", "js/auth.js",
  "js/app.js", "js/room.js", "js/whiteboard.js", "js/chat.js", "js/timer.js",
  "js/files.js", "js/webrtc.js", "js/math-tools.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isBackend(url) {
  // Never intercept the live backend or its realtime websocket.
  return url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (isBackend(url)) return;                    // straight to network

  // Navigations: network first, fall back to the cached shell / offline page.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("offline.html")))
    );
    return;
  }

  // Everything else: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && (url.origin === location.origin || /jsdelivr|unpkg/.test(url.hostname))) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
