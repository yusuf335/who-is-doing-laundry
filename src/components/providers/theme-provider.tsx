"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import { THEME_KEY } from "@/lib/theme";

export type Theme = "light" | "dark" | "system";

const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  // Another tab changing the theme changes it here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function subscribeSystem(listener: () => void) {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

interface ThemeValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * Light, dark, or whatever the device prefers. A small replacement for next-themes,
 * whose inline script React 19.2 warns about when rendered from a client component.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The server cannot know either, so it renders "system" and the client catches up.
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as Theme);
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const root = document.documentElement;
    // Switching should be instant, not a slow fade of every colour on the page.
    const pause = document.createElement("style");
    pause.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.appendChild(pause);
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;
    void root.offsetHeight;
    const id = window.setTimeout(() => pause.remove(), 0);
    return () => {
      window.clearTimeout(id);
      pause.remove();
    };
  }, [resolvedTheme]);

  const value = useMemo<ThemeValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (next) => {
        try {
          if (next === "system") localStorage.removeItem(THEME_KEY);
          else localStorage.setItem(THEME_KEY, next);
        } catch {
          // Storage blocked: the choice lasts until the page is reloaded.
        }
        listeners.forEach((listener) => listener());
      },
    }),
    [theme, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
