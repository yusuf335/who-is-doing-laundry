"use client";

import { IconBell, IconBellOff, IconBellRinging } from "@tabler/icons-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useHouse } from "@/components/providers/house-provider";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { disablePush, enablePush, pushConfigured, pushPermission } from "@/lib/push";
import { runAction } from "@/lib/run-action";
import { registerDeviceAction, unregisterDeviceAction } from "@/server/actions";

const subscribeToNothing = () => () => {};

/**
 * Turns notifications on for this browser. Kept next to the install banner because on
 * iPhone the two go together: notifications only work once the app is on the home screen.
 */
export function NotificationToggle() {
  const { houseId } = useHouse();
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [permission, setPermission] = useState<ReturnType<typeof pushPermission> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  if (!mounted || !pushConfigured()) return null;
  const current = permission ?? pushPermission();
  if (current === "unsupported") return null;

  async function turnOn() {
    if (!houseId) return;
    setBusy(true);
    try {
      const token = await enablePush();
      if (!token) {
        setPermission(pushPermission());
        toast.error(
          "Your browser did not allow notifications. Check its site settings and try again.",
        );
        return;
      }
      await runAction(() => registerDeviceAction({ houseId, token }));
      setPermission("granted");
      toast.success("We will let you know when your laundry is done.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not turn notifications on."));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!houseId) return;
    setBusy(true);
    try {
      const token = await enablePush().catch(() => null);
      if (token) await runAction(() => unregisterDeviceAction({ houseId, token }));
      await disablePush();
      setPermission("default");
      toast.success("We will stay quiet on this device.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not turn notifications off."));
    } finally {
      setBusy(false);
    }
  }

  if (current === "denied") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <IconBellOff className="size-4 shrink-0" aria-hidden />
        Notifications are blocked for this site. Turn them back on in your browser
        settings, then reload.
      </p>
    );
  }

  return (
    <Button
      variant={current === "granted" ? "ghost" : "outline"}
      size="sm"
      className="h-9 w-full justify-start"
      disabled={busy}
      onClick={current === "granted" ? turnOff : turnOn}
    >
      {current === "granted" ? <IconBellRinging /> : <IconBell />}
      {current === "granted"
        ? "We will say when your laundry is done"
        : "Say when my laundry is done"}
    </Button>
  );
}
