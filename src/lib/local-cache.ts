"use client";

import { clearIndexedDbPersistence, terminate, type Firestore } from "firebase/firestore";

/**
 * Firestore's offline cache is keyed by `firestore/{appName}/{projectId}/{database}`, so
 * it is shared by everyone who signs in on this browser. The documents it holds, and the
 * resume tokens for the queries that fetched them, belong to whoever read them first.
 *
 * When a different person signs in, that inheritance is wrong and fails in a way that is
 * very hard to see: a document they are perfectly entitled to read comes back as missing,
 * with no error. So the cache is thrown away whenever the signed-in user changes.
 */
const LAST_UID = "laundry:lastUid";

function readLastUid(): string | null {
  try {
    return localStorage.getItem(LAST_UID);
  } catch {
    // Private windows and blocked storage: behave as if nobody has signed in here.
    return null;
  }
}

export function rememberUser(uid: string): void {
  try {
    localStorage.setItem(LAST_UID, uid);
  } catch {
    // Without storage we cannot tell users apart, so the cache is simply never cleared.
  }
}

/**
 * True when this browser's cache belongs to somebody else. A first sign-in is not a
 * change: there is nothing inherited yet.
 */
export function isDifferentUser(uid: string, lastUid = readLastUid()): boolean {
  return lastUid !== null && lastUid !== uid;
}

/**
 * Throws the cache away and reloads, which is the only reliable way back to a good state:
 * terminating Firestore kills every live listener, so the page has to be rebuilt anyway.
 *
 * The uid is recorded *before* anything else, so a failure here cannot become a reload
 * loop. A stale cache is a bad afternoon; a reload loop is a broken app.
 */
export async function resetLocalCache(db: Firestore, uid: string): Promise<void> {
  rememberUser(uid);

  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch {
    // Another tab can hold the cache open, which makes the official call fail. Deleting
    // the database directly waits for those connections instead of giving up.
    await deleteFirestoreDatabases();
  }

  if (typeof location !== "undefined") location.reload();
}

async function deleteFirestoreDatabases(): Promise<void> {
  try {
    const databases = await indexedDB.databases();
    await Promise.all(
      databases
        .map((entry) => entry.name)
        .filter((name): name is string => Boolean(name?.startsWith("firestore/")))
        .map(
          (name) =>
            new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase(name);
              request.onsuccess = request.onerror = request.onblocked = () => resolve();
            }),
        ),
    );
  } catch {
    // Nothing more to try. The reload below at least gives the SDK a fresh start.
  }
}
