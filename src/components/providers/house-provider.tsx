"use client";

import { onSnapshot } from "firebase/firestore";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { db } from "@/lib/firebase";
import { houseDoc, memberDoc, userDoc } from "@/lib/paths";
import { runAction } from "@/lib/run-action";
import { clearHousePointerAction } from "@/server/actions";
import type { House, Member } from "@/lib/types";

export type HouseStatus = "loading" | "signed-out" | "no-house" | "ready";

/** Which piece has not arrived, so a stuck loading screen can say something useful. */
export type Waiting = "auth" | "pointer" | "membership" | "house" | null;

interface HouseValue {
  status: HouseStatus;
  waitingFor: Waiting;
  houseId: string | null;
  house: House | null;
  member: Member | null;
  isAdmin: boolean;
}

/** The users/{uid} pointer, tagged with the uid it belongs to so stale data is ignored. */
interface Pointer {
  uid: string;
  houseId: string | null;
}

/** House + member snapshots, tagged with the "uid/houseId" pair they were loaded for. */
interface Membership {
  key: string;
  house: House | null;
  member: Member | null;
  memberChecked: boolean;
}

const HouseContext = createContext<HouseValue | null>(null);

/** What the server resolved from the session cookie before the first paint. */
export interface InitialMembership {
  houseId: string;
  house: House;
  member: Member;
}

export function HouseProvider({
  initial,
  children,
}: {
  initial: InitialMembership | null;
  children: React.ReactNode;
}) {
  const { user, loading: authLoading } = useAuth();
  // Seeded from the server so a returning member lands straight on the app shell; the
  // live snapshots below replace the seed as soon as they arrive.
  const [pointer, setPointer] = useState<Pointer | null>(() =>
    initial && user ? { uid: user.uid, houseId: initial.houseId } : null,
  );
  const [membership, setMembership] = useState<Membership | null>(() =>
    initial && user
      ? {
          key: `${user.uid}/${initial.houseId}`,
          house: initial.house,
          member: initial.member,
          memberChecked: true,
        }
      : null,
  );

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    return onSnapshot(
      userDoc(db, uid),
      // A document that does not exist still arrives here, as an empty snapshot. So this
      // is the only place that can conclude somebody has no house.
      (snap) =>
        setPointer({
          uid,
          houseId: (snap.data()?.houseId as string | undefined) ?? null,
        }),
      // An error means we could not find out, which is not the same as "no house".
      // Concluding otherwise would send a member of long standing to onboarding because
      // their connection blinked. Keep whatever we knew and stay on the loading screen.
      (error) => {
        console.error("house pointer listener", error);
        setPointer((prev) => (prev?.uid === uid ? prev : null));
      },
    );
  }, [user]);

  const pointerLoaded = Boolean(user && pointer?.uid === user.uid);
  const houseId = pointerLoaded ? pointer!.houseId : null;
  const membershipKey = user && houseId ? `${user.uid}/${houseId}` : null;

  useEffect(() => {
    if (!user || !houseId || !membershipKey) return;
    const uid = user.uid;
    const key = membershipKey;
    const patch = (changes: Partial<Membership>) =>
      setMembership((prev) => ({
        ...(prev?.key === key
          ? prev
          : { key, house: null, member: null, memberChecked: false }),
        ...changes,
      }));

    const unsubscribeHouse = onSnapshot(
      houseDoc(db, houseId),
      (snap) =>
        patch({
          house: snap.exists() ? ({ id: snap.id, ...snap.data() } as House) : null,
        }),
      // Same rule as the pointer: a failed read is not proof the house is gone. Logged,
      // because a listener that quietly never resolves is painful to diagnose later.
      (error) => console.error("house listener", error),
    );

    const unsubscribeMember = onSnapshot(
      memberDoc(db, houseId, uid),
      (snap) => {
        if (snap.exists()) {
          patch({
            member: { uid: snap.id, ...snap.data() } as Member,
            memberChecked: true,
          });
        } else {
          // A real empty snapshot: the admin removed us. Drop the pointer so onboarding
          // takes over. The server checks again before it erases anything.
          patch({ member: null, memberChecked: true });
          void runAction(() => clearHousePointerAction()).catch((error: unknown) => {
            // The server refuses if we are in fact still a member, which is the point.
            console.error("clear house pointer", error);
          });
        }
      },
      // Never clear the pointer from an error. Losing it strands somebody outside a house
      // they are still in, and for an admin there is no way back in from the outside.
      (error) => console.error("member listener", error),
    );

    return () => {
      unsubscribeHouse();
      unsubscribeMember();
    };
  }, [user, houseId, membershipKey]);

  const value = useMemo<HouseValue>(() => {
    const current =
      membershipKey && membership?.key === membershipKey ? membership : null;
    const house = current?.house ?? null;
    const member = current?.member ?? null;

    let status: HouseStatus = "loading";
    let waitingFor: Waiting = null;
    if (authLoading) {
      status = "loading";
      waitingFor = "auth";
    } else if (!user) status = "signed-out";
    else if (!pointerLoaded) {
      status = "loading";
      waitingFor = "pointer";
    } else if (!houseId) status = "no-house";
    else if (!current?.memberChecked) {
      status = "loading";
      waitingFor = "membership";
    } else if (!member) status = "no-house";
    else if (!house) {
      status = "loading";
      waitingFor = "house";
    } else status = "ready";

    return {
      status,
      waitingFor,
      houseId: status === "ready" ? houseId : null,
      house,
      member,
      isAdmin: Boolean(house && member && house.adminUid === member.uid),
    };
  }, [authLoading, user, pointerLoaded, houseId, membershipKey, membership]);

  return <HouseContext.Provider value={value}>{children}</HouseContext.Provider>;
}

export function useHouse(): HouseValue {
  const value = useContext(HouseContext);
  if (!value) throw new Error("useHouse must be used inside <HouseProvider>");
  return value;
}
