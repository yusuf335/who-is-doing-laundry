"use client";

import { onSnapshot, type Query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

export interface CollectionState<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  /** When we last heard anything from Firestore, cache or server. */
  updatedAt: number | null;
  /**
   * True while the newest snapshot is only the local copy, with no confirmation from the
   * server yet. That is normal for a moment on every load, so treat it as "offline" only
   * once it has stayed true for a while.
   */
  fromCache: boolean;
}

interface Snapshot<T> {
  query: Query;
  data: T[];
  error: Error | null;
  updatedAt: number;
  fromCache: boolean;
}

/**
 * Shared `onSnapshot` plumbing. Callers memoise the query so the subscription is only
 * torn down when the query really changes. The last result is tagged with the query that
 * produced it, so a changed query reads as "loading" without any extra state juggling.
 */
export function useCollection<T>(query: Query | null): CollectionState<T> {
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);

  useEffect(() => {
    if (!query) return;
    return onSnapshot(
      query,
      // Without this, a snapshot that only changes from cache-backed to server-confirmed
      // never reaches us, and the connection would look permanently offline. Metadata
      // events carry no documents, so they add no reads.
      { includeMetadataChanges: true },
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
        setSnapshot({
          query,
          data,
          error: null,
          updatedAt: Date.now(),
          fromCache: snap.metadata.fromCache,
        });
      },
      (error) =>
        setSnapshot({
          query,
          data: [],
          error,
          updatedAt: Date.now(),
          fromCache: false,
        }),
    );
  }, [query]);

  return useMemo(() => {
    const fresh = query !== null && snapshot?.query === query;
    return {
      data: fresh ? snapshot.data : [],
      loading: query !== null && !fresh,
      error: fresh ? snapshot.error : null,
      updatedAt: fresh ? snapshot.updatedAt : null,
      fromCache: fresh ? snapshot.fromCache : false,
    };
  }, [query, snapshot]);
}
