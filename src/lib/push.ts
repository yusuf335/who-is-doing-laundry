"use client";

import { deleteToken, getMessaging, getToken, isSupported } from "firebase/messaging";
import { firebaseConfig, vapidKey } from "@/lib/firebase-config";

/** Where the browser asks for permission, and what came back. */
export type PushPermission = "unsupported" | "default" | "granted" | "denied";

export function pushPermission(): PushPermission {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window) || !("serviceWorker" in navigator))
    return "unsupported";
  return Notification.permission as PushPermission;
}

export function pushConfigured(): boolean {
  return Boolean(vapidKey);
}

/**
 * The worker lives at the site root so it can receive pushes for every page. The public
 * config rides on the query string because a worker cannot read the app's environment.
 */
async function registerWorker(): Promise<ServiceWorkerRegistration> {
  const query = new URLSearchParams({
    apiKey: firebaseConfig.apiKey ?? "",
    authDomain: firebaseConfig.authDomain ?? "",
    projectId: firebaseConfig.projectId ?? "",
    messagingSenderId: firebaseConfig.messagingSenderId ?? "",
    appId: firebaseConfig.appId ?? "",
  });
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${query}`, {
    scope: "/",
  });
}

/**
 * Asks for permission if it has not been asked, then returns the token that identifies
 * this browser to Firebase Cloud Messaging. Returns null whenever notifications are not
 * possible, which is the normal case on a desktop browser with them switched off.
 */
export async function enablePush(): Promise<string | null> {
  if (!vapidKey || !(await isSupported())) return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const registration = await registerWorker();
  const token = await getToken(getMessaging(), {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  return token || null;
}

/** Used when someone turns notifications off, so the server stops sending to this device. */
export async function disablePush(): Promise<void> {
  if (!vapidKey || !(await isSupported())) return;
  try {
    await deleteToken(getMessaging());
  } catch {
    // Already gone, or the worker was unregistered by the browser.
  }
}
