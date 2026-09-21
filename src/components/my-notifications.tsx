"use client";

import { IconBell, IconMail } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { NotificationToggle } from "@/components/notification-toggle";
import { useHouse } from "@/components/providers/house-provider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/errors";
import { pushConfigured } from "@/lib/push";
import { cn } from "@/lib/utils";
import { runAction } from "@/lib/run-action";
import { setMyEmailRemindersAction } from "@/server/actions";

/** Everything one person can decide about being told their own laundry is done. */
export function MyNotifications() {
  const { house, isAdmin } = useHouse();
  const pushReady = pushConfigured();

  // With no key configured there is nothing a member can do about it, so they are not
  // told about a switch that does not exist. The admin gets the instructions instead.
  const showDevice = pushReady || isAdmin;

  return (
    <div className="space-y-4">
      {showDevice && (
        <section className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <IconBell className="size-4" aria-hidden />
            On this device
          </p>
          {pushReady ? <NotificationToggle /> : <PushSetupSteps />}
        </section>
      )}

      <section className={cn("space-y-2", showDevice && "border-t pt-4")}>
        <p className="flex items-center gap-2 text-sm font-medium">
          <IconMail className="size-4" aria-hidden />
          By email
        </p>
        {house?.emailReminders === true ? (
          <EmailOptIn />
        ) : (
          <p className="text-muted-foreground text-xs">
            Your house admin has email switched off, so the app only notifies your
            devices.
          </p>
        )}
      </section>
    </div>
  );
}

/** Admin only: how to switch notifications on for the whole house. */
function PushSetupSteps() {
  return (
    <div className="bg-muted/60 space-y-2 rounded-lg px-3 py-2.5">
      <p className="text-xs font-medium">
        Notifications are not switched on for this house yet.
      </p>
      <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
        <li>
          In the Firebase console, open{" "}
          <span className="text-foreground font-medium">
            Project settings, Cloud Messaging
          </span>
          , and under Web configuration choose{" "}
          <span className="text-foreground font-medium">Generate key pair</span>.
        </li>
        <li>
          Put that key in the app&apos;s environment as{" "}
          <code className="font-mono">NEXT_PUBLIC_FIREBASE_VAPID_KEY</code>.
        </li>
        <li>
          Sending them also needs a service account. Create one with only the{" "}
          <span className="text-foreground font-medium">
            Firebase Cloud Messaging API Admin
          </span>{" "}
          role and add its JSON as <code className="font-mono">FCM_SERVICE_ACCOUNT</code>.
        </li>
        <li>Restart or redeploy, and the switch appears here for everyone.</li>
      </ol>
      <p className="text-muted-foreground text-xs">
        Until then the app tells nobody, unless you switch email on in settings.
      </p>
    </div>
  );
}

function EmailOptIn() {
  const { houseId, member } = useHouse();
  const enabled = member?.emailReminders === true;
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    if (!houseId) return;
    setBusy(true);
    try {
      await runAction(() => setMyEmailRemindersAction({ houseId, enabled: next }));
      toast.success(next ? "We will email you too." : "No more email.");
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
          {enabled ? `Email ${member?.email ?? "me"} as well` : "No email, thanks"}
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">
        Useful if you do not always have the app on your phone. One email per cycle you
        start, nothing else.
      </p>
    </div>
  );
}
