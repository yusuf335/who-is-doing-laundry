"use client";

import {
  onIdTokenChanged,
  signInWithPopup,
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

/** Writes the cookie the server reads, before any navigation that depends on it. */
async function syncCookie(user: User | null): Promise<void> {
  if (user) writeSessionCookie(await user.getIdToken());
  else clearSessionCookie();
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

      void syncCookie(next);
      setUser(next ? toAuthUser(next) : null);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      signInWithGoogle: async () => {
        const credential = await signInWithPopup(auth, googleProvider);
        await syncCookie(credential.user);
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
