"use client";

import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { Waiting } from "@/components/providers/house-provider";

/**
 * Shown when the app has been loading for longer than it ever should be.
 *
 * Every hard bug in this app so far has looked the same from the outside: a loading
 * screen that never resolves, with nothing in the console. Naming the piece that has not
 * arrived turns that into something a person can report and a developer can act on.
 */
const EXPLANATION: Record<Exclude<Waiting, null>, string> = {
  auth: "Waiting for sign-in to come back.",
  pointer: "Signed in, but your house has not loaded.",
  membership: "Found your house, but not your membership in it.",
  house: "Found your membership, but the house itself has not loaded.",
};

export function StuckNotice({ waitingFor }: { waitingFor: Waiting }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-10 text-center">
      <IconAlertTriangle className="text-muted-foreground mx-auto size-8" aria-hidden />
      <div className="space-y-1">
        <h1 className="text-base font-semibold">This is taking too long</h1>
        <p className="text-muted-foreground text-sm">
          {waitingFor ? EXPLANATION[waitingFor] : "Something has not finished loading."}
        </p>
      </div>
      <p className="text-muted-foreground text-xs">
        Usually a connection that dropped. If reloading does not help, tell whoever looks
        after the app which line above you saw.
      </p>
      <Button onClick={() => location.reload()} className="mx-auto w-full sm:w-auto">
        <IconRefresh />
        Reload
      </Button>
    </main>
  );
}
