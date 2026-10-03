"use client";

import { useEffect } from "react";
import { useHouse } from "@/components/providers/house-provider";
import { pushState, subscribe } from "@/lib/push-client";
import { deviceLabel } from "@/lib/push-message";
import { runAction } from "@/lib/run-action";
import { catchUpNotificationsAction, savePushDeviceAction } from "@/server/actions";

/** Who this browser has already been reconnected for, so it happens once per visit. */
let restoredFor: string | null = null;

/**
 * Phone notifications are an account setting, like email. Signing out disconnects this
 * browser (so the next person here gets nothing of yours); signing back in reconnects it
 * here, quietly, when the account has notifications on and the browser already allows
 * them. A browser that has never been asked shows "Use on this device" in Settings
 * instead, since only a tap may open the permission prompt.
 */
export function useRestorePush() {
  const { houseId, member } = useHouse();
  const wanted = member?.pushReminders === true;
  const uid = member?.uid ?? null;

  useEffect(() => {
    if (!houseId || !uid || !wanted || restoredFor === uid) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted")
      return;
    restoredFor = uid;
    void (async () => {
      const state = await pushState();
      if (state !== "on" && state !== "off") return;
      // Permission is already granted, so this subscribes without showing a prompt.
      const subscription = await subscribe();
      if (!subscription) return;
      await runAction(() =>
        savePushDeviceAction({ subscription, label: deviceLabel(navigator.userAgent) }),
      );
      await runAction(() => catchUpNotificationsAction({ houseId }));
    })().catch((error: unknown) => {
      restoredFor = null;
      console.error("restore phone notifications", error);
    });
  }, [houseId, uid, wanted]);
}
