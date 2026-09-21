/*
 * Background handler for push notifications.
 *
 * A service worker cannot read the app's environment, so the page passes the public
 * Firebase config on the registration URL (see src/lib/push.ts). These values are public
 * by design; access is governed by the Firestore rules, not by hiding them.
 */
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js");

const params = new URL(self.location.href).searchParams;
const config = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
};

if (config.projectId) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    self.registration.showNotification(data.title || "Laundry", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "laundry",
      renotify: false,
      data: { url: data.url || "/" },
    });
  });
}

/*
 * Tapping the notification brings the app forward rather than opening a second copy of
 * it. If a window is already open anywhere in the app it is focused and sent to the
 * machine list; only when nothing is open does a new window get created.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      const open = clients.find((client) => client.url.startsWith(self.location.origin));
      if (open) {
        // navigate() is not in every browser, so focus is the part that always happens.
        if (open.url !== target && "navigate" in open) {
          await open.navigate(target).catch(() => {});
        }
        return open.focus();
      }

      return self.clients.openWindow(target);
    })(),
  );
});
