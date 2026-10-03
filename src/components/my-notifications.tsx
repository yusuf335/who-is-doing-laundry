"use client";

import { useState } from "react";
import { IconMailForward } from "@tabler/icons-react";
import { toast } from "sonner";
import { useHouse } from "@/components/providers/house-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/errors";
import { BOOKING_LEAD_MINUTES } from "@/lib/push-message";
import { runAction } from "@/lib/run-action";
import { sendTestEmailAction, setMyEmailRemindersAction } from "@/server/actions";

/**
 * Email is the only way the app reaches you when you are not looking at it, so this is
 * one switch rather than a set. The admin allows email for the house; you decide for
 * yourself, and both start off.
 */
export function MyNotifications() {
  const { houseId, house, member } = useHouse();
  const enabled = member?.emailReminders === true;
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  if (house?.emailReminders !== true) {
    return (
      <p className="text-muted-foreground text-sm">
        Your house admin has email switched off, so the app will not contact you.
      </p>
    );
  }

  async function toggle(next: boolean) {
    if (!houseId) return;
    setBusy(true);
    try {
      await runAction(() => setMyEmailRemindersAction({ houseId, enabled: next }));
      toast.success(next ? "We will email you about your laundry." : "No more email.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not change that setting."));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!houseId) return;
    setTesting(true);
    try {
      const { to } = await runAction(() => sendTestEmailAction({ houseId }));
      toast.success(`Sent to ${to}. Check your inbox, and spam if it is not there.`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not send a test email."));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <Switch
          id="my-email-reminders"
          checked={enabled}
          disabled={busy}
          onCheckedChange={toggle}
        />
        <Label htmlFor="my-email-reminders" className="text-sm font-normal">
          {enabled ? `Email ${member?.email ?? "me"} about my laundry` : "No email"}
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">
        One when a cycle you started finishes, and one {BOOKING_LEAD_MINUTES} minutes
        before each of your bookings. Nothing else.
      </p>
      {enabled && (
        <Button
          variant="outline"
          className="mt-1.5 h-10"
          disabled={testing}
          onClick={sendTest}
        >
          <IconMailForward />
          Send a test email
        </Button>
      )}
    </div>
  );
}
