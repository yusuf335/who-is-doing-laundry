"use client";

import {
  IconCalendarEvent,
  IconChevronRight,
  IconCloudOff,
  IconRefresh,
  IconSettings,
  IconWashMachine,
} from "@tabler/icons-react";
import Link from "next/link";
import { useEffect } from "react";
import { MachineCard } from "@/components/machine-card";
import { useHouse } from "@/components/providers/house-provider";
import { RequireHouse } from "@/components/require-house";
import { ScheduleBanner } from "@/components/schedule-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMachines, useUpcomingBookings } from "@/hooks/use-house-data";
import { useNow } from "@/hooks/use-now";
import { runAction } from "@/lib/run-action";
import { formatDayAndTime } from "@/lib/time";
import { pruneOldRecordsAction } from "@/server/actions";

export default function DashboardPage() {
  return (
    <RequireHouse>
      <Dashboard />
    </RequireHouse>
  );
}

function Dashboard() {
  const { houseId, isAdmin } = useHouse();
  const machines = useMachines();

  const bookings = useUpcomingBookings();
  const now = useNow(1000);

  const upcoming = bookings.data.filter((b) => b.endAt.toMillis() > now);
  const hasExpired = bookings.data.some((b) => b.endAt.toMillis() <= now);

  // Sweeping costs up to 30 reads, so it runs when there is visibly something to clear,
  // and otherwise only every few hours per browser (see /privacy for what it deletes).
  useEffect(() => {
    if (!houseId || bookings.loading) return;
    if (!shouldPrune(hasExpired)) return;
    markPruned();
    void runAction(() => pruneOldRecordsAction({ houseId })).catch(() => {});
  }, [houseId, bookings.loading, hasExpired]);

  return (
    <div className="space-y-3">
      <ScheduleBanner date={new Date(now)} />

      {machines.loading ? (
        <>
          <MachineSkeleton />
          <MachineSkeleton />
        </>
      ) : machines.data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <IconWashMachine className="text-muted-foreground size-8" />
            <p className="text-sm font-medium">No machines yet</p>
            <p className="text-muted-foreground text-sm">
              {isAdmin
                ? "Add a washer or dryer in settings to get started."
                : "Ask your house admin to add a machine in settings."}
            </p>
            {isAdmin && (
              <Button asChild size="lg">
                <Link href="/settings">
                  <IconSettings />
                  Open settings
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        machines.data.map((machine) => (
          <MachineCard
            key={machine.id}
            machine={machine}
            bookings={bookings.data}
            now={now}
          />
        ))
      )}

      <FreshnessLine
        updatedAt={machines.updatedAt}
        fromCache={machines.fromCache}
        now={now}
      />

      <Button
        asChild
        variant="ghost"
        className="text-muted-foreground h-11 w-full justify-between"
      >
        <Link href="/bookings">
          <span className="flex items-center gap-2">
            <IconCalendarEvent />
            Bookings
          </span>
          <span className="flex items-center gap-1 text-xs">
            {upcoming.length > 0 ? `${upcoming.length} upcoming` : "Nothing booked"}
            <IconChevronRight className="size-4" />
          </span>
        </Link>
      </Button>
    </div>
  );
}

/** How long a cache-only snapshot has to persist before we call the connection down. */
const OFFLINE_AFTER_MS = 20_000;

const PRUNE_KEY = "laundry:lastPrune";
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;

function shouldPrune(hasExpired: boolean): boolean {
  if (hasExpired) return true;
  try {
    return Date.now() - Number(localStorage.getItem(PRUNE_KEY) ?? 0) > PRUNE_EVERY_MS;
  } catch {
    // Private windows and blocked storage: fall back to only sweeping what we can see.
    return false;
  }
}

function markPruned(): void {
  try {
    localStorage.setItem(PRUNE_KEY, String(Date.now()));
  } catch {
    // Nothing to do; the worst case is sweeping again on the next load.
  }
}

/**
 * Says the screen keeps itself current, and when it last heard from the database. The
 * data arrives over a live connection, so there is no refresh button to press; when the
 * connection is down Firestore serves its saved copy and this says so.
 */
function FreshnessLine({
  updatedAt,
  fromCache,
  now,
}: {
  updatedAt: number | null;
  fromCache: boolean;
  now: number;
}) {
  if (updatedAt === null) return null;
  const age = Math.max(0, now - updatedAt);

  // Every load starts cache-backed for a moment before the server confirms it, so only
  // call it offline once we have heard nothing for a while.
  const offline = fromCache && age > OFFLINE_AFTER_MS;
  const when =
    age < 60_000 ? "just now" : formatDayAndTime(new Date(updatedAt), new Date(now));

  return (
    <p className="text-muted-foreground flex items-center justify-center gap-1.5 pt-1 text-xs">
      {offline ? (
        <IconCloudOff className="size-3.5" aria-hidden />
      ) : (
        <IconRefresh className="size-3.5" aria-hidden />
      )}
      <span>
        {offline
          ? `Offline, showing saved data from ${when}`
          : `Updates on their own. Last change ${when}`}
      </span>
    </p>
  );
}

function MachineSkeleton() {
  return (
    <Card size="sm" className="border-l-4">
      <CardHeader className="flex flex-row items-center gap-2">
        <Skeleton className="size-5 rounded-full" />
        <Skeleton className="h-5 flex-1" />
        <Skeleton className="h-9 w-16" />
      </CardHeader>
    </Card>
  );
}
