/**
 * Shared by the theme provider (client) and the root layout (server), so it must not
 * live in a "use client" file: the server would get a reference, not the text.
 */

/** The same key next-themes used, so everyone's saved choice carries over. */
export const THEME_KEY = "theme";

/**
 * Runs in the page head before anything paints (see the root layout), so a dark-mode
 * visitor never sees a flash of white. Kept here so the key and the logic live together.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
