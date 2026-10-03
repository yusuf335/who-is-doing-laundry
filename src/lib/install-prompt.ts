"use client";

import { useSyncExternalStore } from "react";

/**
 * Chrome and Edge (Android and desktop) fire `beforeinstallprompt` once the app can be
 * installed; keeping the event lets a button open the browser's own install dialog
 * later. Safari has no such event: on iPhone the only way is Share, Add to Home Screen.
 *
 * The browser's own install hint is left alone (no preventDefault), so this only adds
 * a way to install and never takes one away.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

/** Whether a tap can open the browser's install dialog right now. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => deferred !== null,
    () => false,
  );
}

/** Opens the install dialog. True when the person accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  // The event can only be used once, whatever the answer.
  deferred = null;
  emit();
  await event.prompt();
  return (await event.userChoice).outcome === "accepted";
}

/** Running from the Home Screen or as an installed app, rather than in a browser tab. */
export function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
