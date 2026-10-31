/**
 * Coffee Lab service worker: makes the site installable and gives it an offline page.
 *
 * Deliberately conservative. Pages, scripts and styles always come from the network first, so a
 * deploy is live on the next load and the app never runs old JavaScript against a new server. The
 * cache is only a fallback for when the phone has no connection. /api is never touched: orders,
 * sessions and receipts are always live.
 */
const CACHE = "coffeelab-v1";
const PRECACHE = ["/offline.html", "/css/styles.css", "/js/theme.js", "/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin) return;
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/healthz")) return;

    if (request.mode === "navigate") {
        // The page itself is never stored (it's no-store); offline shows the offline page instead.
        event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
        return;
    }
    if (/^\/(css|js|icons)\//.test(url.pathname)) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
    }
});
