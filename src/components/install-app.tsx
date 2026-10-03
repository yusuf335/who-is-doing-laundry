"use client";

import { IconDownload, IconShare2, IconSquarePlus } from "@tabler/icons-react";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isInstalled, promptInstall, useCanInstall } from "@/lib/install-prompt";
import { isIos } from "@/lib/push-client";

/** Nothing to subscribe to: how the page was opened does not change while it is open. */
function subscribeNever() {
  return () => undefined;
}

/**
 * Putting Laundry on the Home Screen. Where the browser allows it (Chrome and Edge on
 * Android and desktop) one tap opens the real install dialog; iPhone has no such thing,
 * so it gets the two Safari steps instead. Hidden once installed.
 */
export function InstallApp() {
  const canInstall = useCanInstall();
  // Read after hydration only; the server cannot know how the page was opened. A plain
  // string, because a new object each time would look like a change on every render.
  const where = useSyncExternalStore(
    subscribeNever,
    () =>
      isInstalled()
        ? "installed"
        : isIos()
          ? "ios"
          : /android/i.test(navigator.userAgent)
            ? "android"
            : "other",
    () => null,
  );

  if (where === null || where === "installed") return null;
  const client = { ios: where === "ios", android: where === "android" };

  async function install() {
    if (await promptInstall()) toast.success("Laundry is on your Home Screen.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add Laundry to your Home Screen</CardTitle>
        <CardDescription>
          It opens like an app, without the browser around it
          {client.ios ? ", and on iPhone it is what makes notifications possible." : "."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canInstall ? (
          <Button size="lg" className="h-11" onClick={install}>
            <IconDownload />
            {client.android ? "Add to Home Screen" : "Install app"}
          </Button>
        ) : client.ios ? (
          <ol className="space-y-2 text-sm">
            <li className="flex items-center gap-2.5">
              <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-md">
                <IconShare2 className="size-4" aria-hidden />
              </span>
              <span>
                In Safari, tap <strong>Share</strong> at the bottom of the screen.
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-md">
                <IconSquarePlus className="size-4" aria-hidden />
              </span>
              <span>
                Choose <strong>Add to Home Screen</strong>, then open Laundry from there.
              </span>
            </li>
          </ol>
        ) : (
          <p className="text-muted-foreground text-sm">
            Use your browser&apos;s menu and choose <strong>Install</strong> or{" "}
            <strong>Add to Home Screen</strong>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
