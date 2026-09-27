import type { FirebaseOptions } from "firebase/app";

/** Side-effect free so both the browser SDK and the server helper can import it. */
/**
 * Sign-in runs against this app's own origin, where `next.config.ts` proxies Firebase's
 * helper. Pointing it at `<project>.firebaseapp.com` instead makes the flow cross-site,
 * and a browser that partitions storage then completes the sign-in without ever handing
 * the credential back.
 *
 * Only over https, though. Firebase always builds the helper URL as `https://<domain>`,
 * so handing it a plain-http dev server produces https://localhost:3001 and a protocol
 * error. Local development therefore keeps using the Firebase-hosted helper, which is
 * fine: storage partitioning does not bite on localhost, and it is one less redirect URI
 * to register.
 */
function authDomain(): string | undefined {
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return window.location.host;
  }
  return process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
}

export const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: authDomain(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Without a config the SDK would still initialise but every call would fail with an
 * opaque network error, so we check up front and let the UI show setup instructions.
 */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

/**
 * The cookie that carries the Firebase ID token to the server. Firebase Hosting only
 * forwards a cookie with this exact name, so we use it everywhere for consistency.
 */
export const SESSION_COOKIE = "__session";

/** Carries the App Check token to server actions, so they can prove they are the app. */
export const APP_CHECK_COOKIE = "__app_check";

/**
 * Optional. With a reCAPTCHA v3 site key set (and App Check enforced in the Firebase
 * console), Firestore only accepts requests carrying a token minted for this app, which
 * shuts out scripts that merely copied the public config.
 */
export const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY ?? "";

/** The serialisable slice of a Firebase user that the app actually needs. */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}
