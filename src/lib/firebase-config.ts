import type { FirebaseOptions } from "firebase/app";

/** Side-effect free so both the browser SDK and the server helper can import it. */
export const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
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
