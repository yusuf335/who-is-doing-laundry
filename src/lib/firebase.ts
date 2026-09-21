import { getApp, getApps, initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  onTokenChanged,
  ReCaptchaV3Provider,
  type AppCheck,
} from "firebase/app-check";
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
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
 * Plain in-memory cache, deliberately.
 *
 * `persistentLocalCache` looks like an easy saving, but Firestore's IndexedDB cache is
 * keyed by project, not by signed-in user. On a browser where two Google accounts have
 * both been used, the second account inherits the first one's cached documents, including
 * negative entries for documents it was never allowed to read. The symptom is brutal to
 * diagnose: a house document that plainly exists is reported by the server listener as
 * not existing, and the app sits on its loading screen forever.
 *
 * Re-introducing persistence means clearing IndexedDB whenever the signed-in uid changes
 * (`terminate` then `clearIndexedDbPersistence`, then reload). Until that is in place,
 * correctness wins: reads are still bounded, listener-based rather than polled, and the
 * housekeeping sweep is throttled.
 */
export const db = getFirestore(app);
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
