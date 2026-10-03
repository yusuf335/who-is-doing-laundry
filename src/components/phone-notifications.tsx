"use client";

import { IconBellRinging, IconDeviceMobileShare } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
  removePushDeviceAction,
  savePushDeviceAction,
  sendTestPushAction,
} from "@/server/actions";

/**
 * Notifications on this phone or computer: when your cycle finishes, and shortly before
 * your bookings. Per device, because permission is given per browser.
 */
export function PhoneNotifications() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void pushState().then(async (next) => {
      if (!live) return;
      setState(next);
      // Already on here: make sure the server still knows this device, in case it was
      // forgotten since. Quietly when it works; when the server refuses (no keys, too
      // many devices) the switch must not keep claiming notifications are on.
      if (next === "on") {
        const subscription = await currentSubscription();
        if (!subscription) return;
        const result = await savePushDeviceAction({
          subscription: subscription.toJSON(),
          label: deviceLabel(navigator.userAgent),
        });
        if (!result.ok && live) {
          await unsubscribe();
          setState("off");
          toast.error(result.error);
        }
      }
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
      setState("on");
      toast.success("Notifications are on for this device.");
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
      setState("off");
      toast.success("No more notifications on this device.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not turn notifications off."));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await runAction(() => sendTestPushAction());
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
            iPhone only allows notifications from apps on the Home Screen. In Safari, tap
            Share, then Add to Home Screen. Open Laundry from there and come back here.
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

  const on = state === "on";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Switch
          id="phone-notifications"
          checked={on}
          disabled={busy}
          onCheckedChange={(next) => (next ? turnOn() : turnOff())}
        />
        <Label htmlFor="phone-notifications" className="text-sm font-normal">
          {on ? "Notifications on for this device" : "Notify me on this device"}
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">
        When your cycle finishes, and {BOOKING_LEAD_MINUTES} minutes before each of your
        bookings. Turn it on on every phone or computer you want them on.
      </p>
      {on && (
        <Button variant="outline" className="h-10" disabled={busy} onClick={test}>
          <IconBellRinging />
          Send a test
        </Button>
      )}
    </div>
  );
}
