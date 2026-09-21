"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** Chrome fires this so a site can offer installation at a moment of its choosing. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  | "installed"
  | "ready" // the browser will show a native install prompt
  | "manual" // iOS and anything else without one: show the steps instead
  | "unknown"; // still on the server, or the first paint

const subscribeToNothing = () => () => {};

/** True once the app is running from the home screen rather than a browser tab. */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    window.matchMedia("(display-mode: standalone)").matches || iosStandalone === true
  );
}

function isApplePortable(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, so a touch screen is what separates the two.
  return (
    /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

/**
 * Everything the install banner needs: whether the app is already on the home screen,
 * whether the browser will do it in one tap, and a snooze so the reminder can come back
 * tomorrow instead of nagging on every screen.
 */
export function useInstallPrompt() {
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installedNow, setInstalledNow] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Stops the browser's own bar so the banner below can choose the moment.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalledNow(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const state: InstallState = !mounted
    ? "unknown"
    : installedNow || isStandalone()
      ? "installed"
      : deferred
        ? "ready"
        : "manual";

  const install = useCallback(async () => {
    if (!deferred) return "unavailable" as const;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome;
  }, [deferred]);

  return {
    state,
    /** Apple devices need the Share sheet, so the banner shows steps rather than a button. */
    isApple: mounted && isApplePortable(),
    install,
  };
}
