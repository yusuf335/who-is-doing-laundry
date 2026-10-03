/*
 * The app's service worker. It does one job: show the notifications the server sends
 * (a cycle that finished, a booking about to start) and open the app when one is tapped.
 * It caches nothing, so the app always loads fresh from the network.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: show what we can rather than nothing.
    message = { body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    self.registration.showNotification(message.title || "Laundry", {
      body: message.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // A newer notification about the same cycle or booking replaces the older one,
      // and still announces itself: without renotify the replacement lands silently.
      tag: message.tag || "laundry",
      renotify: true,
      data: { url: message.url || "/" },
    }),
  );
});

// Tapping brings an open copy of the app forward instead of starting a second one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find((w) => w.url.startsWith(self.location.origin));
        if (!open) return self.clients.openWindow(target);
        if (open.url !== target && "navigate" in open) {
          // Some browsers refuse to navigate from here; focusing still works.
          open.navigate(target).catch(() => {});
        }
        return open.focus();
      }),
  );
});
