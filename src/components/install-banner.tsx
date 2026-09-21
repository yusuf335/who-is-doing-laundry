"use client";

import { IconBell, IconDeviceMobilePlus, IconSquarePlus } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NotificationToggle } from "@/components/notification-toggle";
import { useInstallPrompt } from "@/hooks/use-install-prompt";

/**
 * Nudges people to put the app on their home screen, which on iOS is the only way to get
 * notifications at all. There is no dismiss: it stays until the app is installed, then it
 * is replaced by the notification switch.
 */
export function InstallBanner() {
  const { state, isApple, install } = useInstallPrompt();
  const [stepsOpen, setStepsOpen] = useState(false);

  if (state === "unknown") return null;
  if (state === "installed") return <NotificationToggle />;

  async function add() {
    if (state === "ready") {
      const outcome = await install();
      if (outcome === "accepted") toast.success("Added. Open it from your home screen.");
      return;
    }
    setStepsOpen(true);
  }

  return (
    <>
      <div className="bg-primary/5 border-primary/20 flex items-center gap-3 rounded-lg border px-3 py-2">
        <IconDeviceMobilePlus className="text-primary size-5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 text-xs">
          <span className="font-medium">Add it to your home screen</span>
          <span className="text-muted-foreground block">
            Opens like an app, and it is how we tell you when your laundry is done.
          </span>
        </p>
        <Button size="sm" className="h-9 shrink-0" onClick={add}>
          Add
        </Button>
      </div>

      <InstallSteps isApple={isApple} open={stepsOpen} onOpenChange={setStepsOpen} />
    </>
  );
}

/** The menu path differs per browser, so this names the one the person is looking at. */
export function InstallSteps({
  isApple,
  open,
  onOpenChange,
}: {
  isApple: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add to your home screen</DialogTitle>
          <DialogDescription>
            {isApple
              ? "Safari puts it there in two taps."
              : "Your browser keeps this in its menu."}
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3 text-sm">
          {isApple ? (
            <>
              <Step n={1}>
                Tap the <span className="font-medium">Share</span> button at the bottom of
                Safari, the square with an arrow coming out of it.
              </Step>
              <Step n={2}>
                Scroll down and tap{" "}
                <span className="inline-flex items-center gap-1 font-medium">
                  <IconSquarePlus className="size-4" aria-hidden />
                  Add to Home Screen
                </span>
                .
              </Step>
              <Step n={3}>
                Tap <span className="font-medium">Add</span>, then open the app from your
                home screen instead of Safari.
              </Step>
            </>
          ) : (
            <>
              <Step n={1}>
                Open your browser&apos;s menu, the three dots in the corner.
              </Step>
              <Step n={2}>
                Choose <span className="font-medium">Add to Home screen</span> or{" "}
                <span className="font-medium">Install app</span>.
              </Step>
              <Step n={3}>Confirm, then open it from your home screen.</Step>
            </>
          )}
        </ol>

        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <IconBell className="mt-0.5 size-4 shrink-0" aria-hidden />
          {isApple
            ? "On iPhone and iPad, we can only say when your laundry is done once the app is on your home screen. That is an Apple rule, not ours."
            : "Once it is installed you can switch on a notification for when your laundry is done."}
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
        {n}
      </span>
      <span className="text-muted-foreground pt-0.5">{children}</span>
    </li>
  );
}
