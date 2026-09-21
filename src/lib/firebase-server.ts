import "server-only";

import { deleteApp, initializeServerApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import { cookies } from "next/headers";
import {
  APP_CHECK_COOKIE,
  SESSION_COOKIE,
  firebaseConfig,
  isFirebaseConfigured,
  type AuthUser,
} from "@/lib/firebase-config";
import type { House, Member } from "@/lib/types";

const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

/** Everything a server action needs to act as the signed-in user. */
export interface ServerContext {
  db: Firestore;
  user: AuthUser;
}

/**
 * Runs `work` against a FirebaseServerApp signed in as the caller (from the session
 * cookie). Returns `null` when nobody is signed in. The app is torn down afterwards.
 */
export async function withServerUser<T>(
  work: (ctx: ServerContext) => Promise<T>,
): Promise<T | null> {
  // Read the cookie before anything else: it is what marks the route as dynamic, so
  // Next never prerenders a signed-out shell even when Firebase is not configured.
  const jar = await cookies();
  const idToken = jar.get(SESSION_COOKIE)?.value;
  if (!isFirebaseConfigured || !idToken) return null;

  // Forwarded so that, with App Check enforced, the server's Firestore calls pass too.
  const appCheckToken = jar.get(APP_CHECK_COOKIE)?.value;
  const app = initializeServerApp(firebaseConfig, {
    authIdToken: idToken,
    ...(appCheckToken ? { appCheckToken } : {}),
  });
  try {
    const auth = getAuth(app);
    const db = getFirestore(app);
    // A fresh server app per request, so this never double-connects.
    if (useEmulators) {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
    }
    await auth.authStateReady();
    const current = auth.currentUser;
    if (!current) return null;
    return await work({
      db,
      user: { uid: current.uid, email: current.email, displayName: current.displayName },
    });
  } finally {
    await deleteApp(app).catch(() => {});
  }
}

/** What the server could establish before the first byte was sent. */
export interface ServerSession {
  user: AuthUser | null;
  /** Present only when the user is a confirmed member of a house. */
  membership: { houseId: string; house: House; member: Member } | null;
}

const EMPTY: ServerSession = { user: null, membership: null };

/**
 * Lets the root layout render the signed-in state on the first paint. A missing,
 * expired or garbled token yields the empty session, never an error, and the client
 * SDK takes over from there exactly as it would without server auth.
 */
export async function getServerSession(): Promise<ServerSession> {
  try {
    const session = await withServerUser(async ({ db, user }) => {
      const pointer = await getDoc(doc(db, "users", user.uid));
      const houseId = pointer.data()?.houseId as string | undefined;
      if (!houseId) return { user, membership: null } satisfies ServerSession;

      const [houseSnap, memberSnap] = await Promise.all([
        getDoc(doc(db, "houses", houseId)),
        getDoc(doc(db, "houses", houseId, "members", user.uid)),
      ]);
      if (!houseSnap.exists() || !memberSnap.exists()) {
        return { user, membership: null } satisfies ServerSession;
      }

      // Timestamps are not serialisable across the server/client boundary; the live
      // snapshot on the client fills them in a moment later.
      const house = { id: houseSnap.id, ...houseSnap.data(), createdAt: null } as House;
      const member = {
        uid: memberSnap.id,
        ...memberSnap.data(),
        joinedAt: null,
      } as Member;
      return { user, membership: { houseId, house, member } } satisfies ServerSession;
    });
    return session ?? EMPTY;
  } catch {
    return EMPTY;
  }
}
