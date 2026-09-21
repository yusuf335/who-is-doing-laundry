import { APP_CHECK_COOKIE, SESSION_COOKIE } from "@/lib/firebase-config";

/**
 * Longer than the one-hour life of an ID token on purpose. The server treats a stale
 * token as "unknown, let the client decide" rather than "signed out", so an expired
 * cookie never bounces someone to /login while the SDK is quietly refreshing.
 */
const MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

function attributes(): string {
  // Safari rejects `Secure` cookies over plain http://localhost; Chrome tolerates them.
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  return `Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function writeSessionCookie(idToken: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SESSION_COOKIE}=${idToken}; Max-Age=${MAX_AGE_SECONDS}; ${attributes()}`;
}

export function clearSessionCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SESSION_COOKIE}=; Max-Age=0; ${attributes()}`;
}

/** App Check tokens live about an hour; the SDK refreshes them and we mirror each one. */
export function writeAppCheckCookie(token: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${APP_CHECK_COOKIE}=${token}; Max-Age=${60 * 60}; ${attributes()}`;
}
