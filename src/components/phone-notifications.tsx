"use client";

import { IconBellRinging, IconDeviceMobileShare } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useHouse } from "@/components/providers/house-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/errors";
import {
  currentSubscription,
  pushState,
  subscribe,
  unsubscribe,
  type PushState,
} from "@/lib/push-client";
import { BOOKING_LEAD_MINUTES, deviceLabel } from "@/lib/push-message";
import { runAction } from "@/lib/run-action";
import {
  catchUpNotificationsAction,
  removePushDeviceAction,
  savePushDeviceAction,
  sendTestPushAction,
  setMyPushRemindersAction,
} from "@/server/actions";

/**
 * Phone notifications: when your cycle finishes, and around your bookings. The switch is
 * an account setting, saved like email, so it stays on through signing out; each device
 * also needs the browser's permission once, which is what "Use on this device" asks for.
 */
export function PhoneNotifications() {
  const { houseId, member } = useHouse();
  const wanted = member?.pushReminders === true;
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void pushState().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const subscription = await subscribe();
      if (!subscription) {
        setState(await pushState());
        return;
      }
      try {
        await runAction(() =>
          savePushDeviceAction({ subscription, label: deviceLabel(navigator.userAgent) }),
        );
      } catch (error) {
        // The server could not keep it, so do not leave the browser subscribed.
        await unsubscribe();
        throw error;
      }
      if (houseId) {
        await runAction(() => setMyPushRemindersAction({ houseId, enabled: true }));
      }
      setState("on");
      toast.success("Notifications are on.");
      // Bookings you already have get their reminders now, not only new ones.
      if (houseId) {
        void runAction(() => catchUpNotificationsAction({ houseId })).catch(
          (error: unknown) => console.error("catch up notifications", error),
        );
      }
    } catch (error) {
      toast.error(errorMessage(error, "Could not turn notifications on."));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const endpoint = await unsubscribe();
      if (endpoint) await runAction(() => removePushDeviceAction({ endpoint }));
      if (houseId) {
        await runAction(() => setMyPushRemindersAction({ houseId, enabled: false }));
      }
      setState("off");
      toast.success("Notifications are off.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not turn notifications off."));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const subscription = await currentSubscription();
      if (!subscription) {
        setState("off");
        throw new Error(
          "This browser is no longer subscribed. Turn notifications on again.",
        );
      }
      await runAction(() =>
        sendTestPushAction({
          subscription: subscription.toJSON(),
          label: deviceLabel(navigator.userAgent),
        }),
      );
      toast.success("Sent. It should arrive in a moment.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not send a test."));
    } finally {
      setBusy(false);
    }
  }

  if (state === null) return <Skeleton className="h-10 w-full" />;

  if (state === "not-configured") {
    return (
      <p className="text-muted-foreground text-sm">
        Phone notifications are not set up for this app yet.
      </p>
    );
  }

  if (state === "needs-home-screen") {
    return (
      <div className="bg-muted/60 flex gap-3 rounded-lg p-3 text-sm">
        <IconDeviceMobileShare className="text-muted-foreground mt-0.5 size-5 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">Add Laundry to your Home Screen first</p>
          <p className="text-muted-foreground">
            iPhone only allows notifications from apps on the Home Screen. Follow the two
            steps above, then open Laundry from your Home Screen and come back here.
          </p>
        </div>
      </div>
    );
  }

  if (state === "unsupported") {
    return (
      <p className="text-muted-foreground text-sm">
        This browser cannot show notifications. Chrome, Edge and Firefox can, and so can
        Safari once the app is on an iPhone&apos;s Home Screen.
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="text-muted-foreground text-sm">
        Notifications are blocked for this site. Allow them in your browser&apos;s site
        settings, then come back here.
      </p>
    );
  }

  const here = state === "on";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Switch
          id="phone-notifications"
          checked={wanted || here}
          disabled={busy}
          onCheckedChange={(next) => (next ? turnOn() : turnOff())}
        />
        <Label htmlFor="phone-notifications" className="text-sm font-normal">
          {wanted || here ? "Phone notifications on" : "Notify me on my phone"}
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">
        When your cycle finishes, {BOOKING_LEAD_MINUTES} minutes before each booking, and
        while a machine of yours waits to be emptied. Saved on your account, so it stays
        on when you sign out and back in.
      </p>
      {wanted && !here && (
        <div className="bg-muted/60 flex flex-wrap items-center gap-3 rounded-lg p-3 text-sm">
          <p className="min-w-0 flex-1">
            On for your account, but not on this device yet.
          </p>
          <Button className="h-10" disabled={busy} onClick={turnOn}>
            Use on this device
          </Button>
        </div>
      )}
      {here && (
        <Button variant="outline" className="h-10" disabled={busy} onClick={test}>
          <IconBellRinging />
          Send a test
        </Button>
      )}
    </div>
  );
}
