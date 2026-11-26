// Minimal service worker: cache the app shell, never queue joins, codes, checks or payments.
const SHELL = "eq-shell-v1";
self.addEventListener("install", (e) => e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/sign-in"])).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/")) return; // live server only
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(SHELL).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener("push", (e) => {
  const d = e.data ? e.data.json() : { title: "Eduquench", body: "You have a new check." };
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: "/icons/icon-192.png", data: d.url || "/dashboard" }));
});
self.addEventListener("notificationclick", (e) => { e.notification.close(); e.waitUntil(clients.openWindow(e.notification.data)); });
