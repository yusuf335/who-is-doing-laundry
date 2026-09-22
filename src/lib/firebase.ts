import { getApp, getApps, initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  onTokenChanged,
  ReCaptchaV3Provider,
  type AppCheck,
} from "firebase/app-check";
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import {
  appCheckSiteKey,
  firebaseConfig,
  isFirebaseConfigured,
} from "@/lib/firebase-config";
import { writeAppCheckCookie } from "@/lib/session-cookie";

export { isFirebaseConfigured } from "@/lib/firebase-config";

const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

const app =
  getApps().length > 0
    ? getApp()
    : initializeApp(
        isFirebaseConfigured
          ? firebaseConfig
          : { apiKey: "unconfigured", projectId: "unconfigured", appId: "unconfigured" },
      );

export const auth = getAuth(app);

/**
 * Firestore keeps what it has read in IndexedDB, so reopening the app or coming back
 * tomorrow serves the machines, members and bookings from disk and asks the server only
 * for what changed. It also means the last known state still renders with no connection.
 *
 * That cache is shared by every account used on this browser, which is a real hazard:
 * see `src/lib/local-cache.ts`, which throws it away whenever the signed-in user changes.
 */
function createFirestore(): Firestore {
  if (typeof window === "undefined") return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Already initialised (a hot reload, or a second import): reuse it as it is.
    return getFirestore(app);
  }
}

export const db = createFirestore();
export const googleProvider = new GoogleAuthProvider();

/**
 * App Check, when a site key is configured. The token is mirrored into a cookie so the
 * server actions can present it too. In development a debug token (set in the console
 * under App Check → Manage debug tokens) stands in for reCAPTCHA.
 */
export let appCheck: AppCheck | null = null;

if (appCheckSiteKey && isFirebaseConfigured && typeof window !== "undefined") {
  const debugToken = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN;
  if (debugToken) {
    (
      self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }
    ).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
  }
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  onTokenChanged(appCheck, (result) => writeAppCheckCookie(result.token));
}

if (useEmulators && typeof window !== "undefined") {
  const w = window as typeof window & { __laundryEmulatorsConnected?: boolean };
  if (!w.__laundryEmulatorsConnected) {
    w.__laundryEmulatorsConnected = true;
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
}
