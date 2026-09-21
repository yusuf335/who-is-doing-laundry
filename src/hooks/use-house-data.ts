"use client";

import { limit, orderBy, query, where, type Query } from "firebase/firestore";
import { useMemo } from "react";
import { Timestamp } from "firebase/firestore";
import { useHouse } from "@/components/providers/house-provider";
import { useCollection } from "@/hooks/use-collection";
import { useNow } from "@/hooks/use-now";
import { db } from "@/lib/firebase";
import {
  bookingsCol,
  joinRequestsCol,
  machinesCol,
  membersCol,
  sessionsCol,
} from "@/lib/paths";
import { startOfDay } from "@/lib/time";
import {
  sortMachines,
  type Booking,
  type JoinRequest,
  type LaundrySession,
  type Machine,
  type Member,
} from "@/lib/types";

export function useMachines() {
  const { houseId } = useHouse();
  const q = useMemo<Query | null>(
    () => (houseId ? query(machinesCol(db, houseId), orderBy("name"), limit(50)) : null),
    [houseId],
  );
  const state = useCollection<Machine>(q);
  return useMemo(() => ({ ...state, data: sortMachines(state.data) }), [state]);
}

export function useMembers() {
  const { houseId } = useHouse();
  const q = useMemo<Query | null>(
    () =>
      houseId ? query(membersCol(db, houseId), orderBy("displayName"), limit(200)) : null,
    [houseId],
  );
  const state = useCollection<Member & { id: string }>(q);
  return useMemo(
    () => ({ ...state, data: state.data.map((m) => ({ ...m, uid: m.id })) as Member[] }),
    [state],
  );
}

/** Everything from midnight today onwards, enough for "today" and the week ahead. */
export function useUpcomingBookings() {
  const { houseId } = useHouse();
  // Only changes at midnight, so a phone left open overnight re-queries for the new day.
  const dayKey = startOfDay(new Date(useNow(60_000))).getTime();
  const q = useMemo<Query | null>(() => {
    if (!houseId) return null;
    return query(
      bookingsCol(db, houseId),
      where("startAt", ">=", Timestamp.fromMillis(dayKey)),
      orderBy("startAt"),
      limit(200),
    );
  }, [houseId, dayKey]);
  return useCollection<Booking>(q);
}

/** The house log: most recent cycles first. Nothing older than a week survives pruning. */
export function useRecentSessions(count = 50) {
  const { houseId } = useHouse();
  const q = useMemo<Query | null>(
    () =>
      houseId
        ? query(sessionsCol(db, houseId), orderBy("startedAt", "desc"), limit(count))
        : null,
    [houseId, count],
  );
  return useCollection<LaundrySession>(q);
}

/** Pending join requests, for the admin's settings screen. */
export function useJoinRequests() {
  const { houseId, isAdmin } = useHouse();
  const q = useMemo<Query | null>(
    () =>
      houseId && isAdmin
        ? query(joinRequestsCol(db, houseId), where("status", "==", "pending"), limit(50))
        : null,
    [houseId, isAdmin],
  );
  return useCollection<JoinRequest & { id: string }>(q);
}
