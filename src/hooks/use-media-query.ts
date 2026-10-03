"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches. False on the server and on the first client paint,
 * so only use it for things that open after an interaction (sheets, dialogs); layouts
 * that are visible on load should switch with CSS breakpoints instead.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The breakpoint where the calendar switches to the desktop layout (Tailwind `lg`). */
export const DESKTOP_QUERY = "(min-width: 1024px)";
