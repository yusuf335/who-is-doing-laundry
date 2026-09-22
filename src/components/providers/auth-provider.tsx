"use client";

import { FirebaseError } from "firebase/app";
import {
  getRedirectResult,
  onIdTokenChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { auth, db, googleProvider, isFirebaseConfigured } from "@/lib/firebase";
import type { AuthUser } from "@/lib/firebase-config";
import { isDifferentUser, rememberUser, resetLocalCache } from "@/lib/local-cache";
import { clearSessionCookie, writeSessionCookie } from "@/lib/session-cookie";

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function toAuthUser(user: User): AuthUser {
  return { uid: user.uid, email: user.email, displayName: user.displayName };
}

/**
 * A popup is the nicer sign-in when it is allowed, but it is not always allowed: strict
 * browser settings block it, and an installed app has no window to open one in. These are
 * the ways that shows up, and each one means "hand the whole page to Google instead".
 */
const POPUP_UNAVAILABLE = new Set([
  "auth/popup-blocked",
  "auth/cancelled-popup-request",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
]);

/** An installed app cannot open a popup at all, so it never tries. */
function runningAsInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    window.matchMedia("(display-mode: standalone)").matches || iosStandalone === true
  );
}

/** Writes the cookie the server reads, before any navigation that depends on it. */
async function syncCookie(user: User | null): Promise<void> {
  if (!user) {
    clearSessionCookie();
    return;
  }
  try {
    writeSessionCookie(await user.getIdToken());
  } catch (error) {
    // Without the cookie the server cannot see this session, so every page would bounce
    // to /login. Loud, because the app still half-works and the cause is invisible.
    console.error("could not write the session cookie", error);
  }
}

export function AuthProvider({
  initialUser,
  children,
}: {
  /** Resolved on the server from the session cookie; lets the first paint skip loading. */
  initialUser: AuthUser | null;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  // Nothing to wait for when the server already knows who this is, or when there is no
  // Firebase project to ask.
  const [loading, setLoading] = useState(isFirebaseConfigured && initialUser === null);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    // Completes a redirect sign-in. The user also arrives through onIdTokenChanged, so
    // this is here to surface a failure that would otherwise look like nothing happened.
    void getRedirectResult(auth).catch((error: unknown) => {
      console.error("redirect sign-in", error);
    });
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    // Fires on sign-in, sign-out and every hourly token refresh, keeping the cookie fresh
    // for as long as a tab is open.
    return onIdTokenChanged(auth, (next) => {
      // A different person on this browser inherits the last one's offline cache, which
      // misreports documents they are entitled to read. Throw it away before anything
      // subscribes to it; the page reloads, so there is no state to update here.
      if (next && isDifferentUser(next.uid)) {
        void resetLocalCache(db, next.uid);
        return;
      }
      if (next) rememberUser(next.uid);

      // The cookie has to exist *before* anything reacts to being signed in. Publishing
      // the user first lets a page navigate while the cookie is still being written, and
      // the proxy then sees a signed-out request and sends it back to /login, which
      // reads as a login loop.
      void (async () => {
        await syncCookie(next);
        setUser(next ? toAuthUser(next) : null);
        setLoading(false);
      })();
    });
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      signInWithGoogle: async () => {
        if (runningAsInstalledApp()) {
          await signInWithRedirect(auth, googleProvider);
          return;
        }
        try {
          const credential = await signInWithPopup(auth, googleProvider);
          await syncCookie(credential.user);
        } catch (error) {
          if (error instanceof FirebaseError && POPUP_UNAVAILABLE.has(error.code)) {
            // The page navigates to Google and comes back signed in, where
            // onIdTokenChanged below picks it up exactly as it would after a popup.
            await signInWithRedirect(auth, googleProvider);
            return;
          }
          throw error;
        }
      },
      signOut: async () => {
        clearSessionCookie();
        await firebaseSignOut(auth);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
