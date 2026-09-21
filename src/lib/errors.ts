import { FirebaseError } from "firebase/app";

/** Errors carrying a message we are happy to show verbatim in a toast. */
export class LaundryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaundryError";
  }
}

export function fail(message: string): never {
  throw new LaundryError(message);
}

const AUTH_MESSAGES: Record<string, string> = {
  "auth/popup-closed-by-user": "The Google sign-in window was closed.",
  "auth/cancelled-popup-request": "The Google sign-in window was closed.",
  "auth/popup-blocked": "Your browser blocked the sign-in popup.",
  "auth/network-request-failed": "No connection. Check your network and try again.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/unauthorized-domain":
    "This domain isn't in the Firebase Auth authorized domains list.",
  "auth/operation-not-allowed":
    "Google sign-in isn't enabled for this Firebase project yet.",
};

const FIRESTORE_MESSAGES: Record<string, string> = {
  "permission-denied": "You don't have permission to do that.",
  unavailable: "Can't reach the database right now. Try again in a moment.",
  "failed-precondition": "Someone changed this just before you did. Try again.",
  aborted: "Someone else got there first. Try again.",
};

/** Turns whatever was thrown into a sentence worth putting in a toast. */
export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof LaundryError) return error.message;
  if (error instanceof FirebaseError) {
    return AUTH_MESSAGES[error.code] ?? FIRESTORE_MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
