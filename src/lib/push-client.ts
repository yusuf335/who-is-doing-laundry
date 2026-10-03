"use client";

/**
 * The browser half of phone notifications: asking permission, subscribing this browser
 * with the app's public VAPID key, and undoing it. The server is told about the result
 * through server actions; nothing here talks to Firestore.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";

export type PushState =
  /** No VAPID key in this deployment: the feature is switched off. */
  | "not-configured"
  /** iPhone or iPad in Safari: it has to be added to the Home Screen first. */
  | "needs-home-screen"
  /** The browser has no Web Push at all. */
  | "unsupported"
  /** The person said no; only the browser's own settings can undo that. */
  | "denied"
  | "off"
  | "on";

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as a Mac, but a Mac has no touch screen.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported(): boolean {
  return (
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
  );
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** This browser's current subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function pushState(): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return "not-configured";
  if (isIos() && !isStandalone()) return "needs-home-screen";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return (await currentSubscription()) ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(current: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((b, i) => b === expected[i]);
}

/**
 * Asks for permission (the browser only shows its prompt after a tap, which is why this
 * runs from the switch) and subscribes. Returns the subscription to hand to the server,
 * or null when permission was not given.
 */
export async function subscribe(): Promise<PushSubscriptionJSON | null> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const key = keyBytes(VAPID_PUBLIC_KEY);
  let subscription = await reg.pushManager.getSubscription();
  // Made with an older server key, every push to it would fail: start again.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  return subscription.toJSON();
}

/** Stops this browser receiving anything, and returns the endpoint to forget. */
export async function unsubscribe(): Promise<string | null> {
  const subscription = await currentSubscription();
  if (!subscription) return null;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}
