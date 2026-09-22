"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useHouse } from "@/components/providers/house-provider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/errors";
import { runAction } from "@/lib/run-action";
import { setMyEmailRemindersAction } from "@/server/actions";

/**
 * Email is the only way the app reaches you when you are not looking at it, so this is
 * one switch rather than a set. The admin allows email for the house; you decide for
 * yourself, and both start off.
 */
export function MyNotifications() {
  const { houseId, house, member } = useHouse();
  const enabled = member?.emailReminders === true;
  const [busy, setBusy] = useState(false);

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
      toast.success(next ? "We will email you when it is done." : "No more email.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not change that setting."));
    } finally {
      setBusy(false);
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
          {enabled
            ? `Email ${member?.email ?? "me"} when my laundry is done`
            : "No email"}
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">
        One email per cycle you start, sent when it finishes. Nothing else.
      </p>
    </div>
  );
}
