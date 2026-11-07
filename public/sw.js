/*
 * ИЛ ТОД service worker: push notifications and an offline fallback page.
 * Pages are never cached here (news must be fresh); Vercel's CDN does that.
 */
const OFFLINE_CACHE = "iltod-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      // Navigation preload: the page request starts while the worker boots instead of after it.
      .then(() => (self.registration.navigationPreload ? self.registration.navigationPreload.enable() : undefined))
      .then(() => self.clients.claim()),
  );
});

// Navigations go to the network; without a connection show the offline page.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) || (await fetch(event.request));
      } catch {
        return (await caches.match(OFFLINE_URL)) || Response.error();
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "ИЛ ТОД", body: event.data ? event.data.text() : "" };
  }
  // A null or non-object payload must still show a notification (not throw before it).
  if (!data || typeof data !== "object") data = {};
  const title = data.title || "ИЛ ТОД";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  // Only our own pages open from a notification.
  if (target.origin !== self.location.origin) target = new URL("/", self.location.origin);
  target = target.href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url === target && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

// The browser rotated the subscription (expiry, key change). It fires with no tab open, so the
// worker re-subscribes itself (the old subscription's options carry the VAPID key; else
// /api/push GET gives it) and posts the new one to /api/push, which also moves the follows from
// the old endpoint. Open windows are still told, so their bell stays in step (use-pwa.ts).
async function renewPush(event) {
  try {
    let options = event.oldSubscription && event.oldSubscription.options;
    if (!options || !options.applicationServerKey) {
      const res = await fetch("/api/push", { cache: "no-store" });
      const { key } = await res.json();
      if (!key) return;
      const padded = (key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
      const raw = atob(padded);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      options = { userVisibleOnly: true, applicationServerKey: bytes };
    }
    const sub = event.newSubscription || (await self.registration.pushManager.subscribe(options));
    const body = JSON.parse(JSON.stringify(sub));
    body.oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : undefined;
    await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    // The page-side renewal (use-pwa.ts) retries on the next visit.
  }
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    renewPush(event).then(() =>
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
        for (const w of windows) w.postMessage({ type: "iltod-push-renew" });
      }),
    ),
  );
});
