"use client";

import {
  IconCloudOff,
  IconRefresh,
  IconSettings,
  IconWashMachine,
} from "@tabler/icons-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LoadError } from "@/components/load-error";
import { MachineCard } from "@/components/machine-card";
import { useHouse } from "@/components/providers/house-provider";
import { RequireHouse } from "@/components/require-house";
import { ScheduleBanner } from "@/components/schedule-banner";
import { BookingFlow, type FlowState } from "@/components/schedule/booking-flow";
import { DesktopCalendar } from "@/components/schedule/desktop-calendar";
import { MyBookings } from "@/components/schedule/my-bookings";
import { PhoneSchedule } from "@/components/schedule/phone-schedule";
import {
  DesktopTodaySkeleton,
  PhoneTodaySkeleton,
  TodaySkeleton,
} from "@/components/schedule/today-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMachines, useUpcomingBookings } from "@/hooks/use-house-data";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { machineColors } from "@/lib/machine-color";
import { runAction } from "@/lib/run-action";
import { formatDayAndTime } from "@/lib/time";
import { isNoShow, type Booking, type Machine } from "@/lib/types";
import { sessionBlocks } from "@/lib/week";
import { catchUpNotificationsAction, pruneOldRecordsAction } from "@/server/actions";

/** The catch-up runs once per visit, not each time the Today screen is opened. */
let caughtUpFor: string | null = null;

export default function TodayPage() {
  return (
    // Shaped like the screen itself while the house loads, rather than a spinner.
    <RequireHouse skeleton={<TodaySkeleton />}>
      <Today />
    </RequireHouse>
  );
}

/**
 * What the machines are doing now and who has booked what, on one screen. Phones get
 * the machine cards over a three-day calendar; wide screens get a Google Calendar style
 * layout. Both open the same booking sheet.
 */
function Today() {
  const { houseId } = useHouse();
  const machines = useMachines();
  const bookings = useUpcomingBookings();
  const now = useNow(1000);
  // The calendar only needs the minute; keeping it steady between ticks lets it skip
  // re-rendering every second while the countdowns above it run.
  const minuteNow = Math.floor(now / 60_000) * 60_000;
  const colors = useMemo(() => machineColors(machines.data), [machines.data]);
  // Running cycles sit on the calendar next to the bookings, so their time never looks free.
  // A booking nobody started within 15 minutes is released: free everywhere at once,
  // even before the tidy-up deletes it.
  const liveBookings = useMemo(
    () => bookings.data.filter((b) => !isNoShow(b, minuteNow)),
    [bookings.data, minuteNow],
  );
  const calendarBookings = useMemo(
    () => [...liveBookings, ...sessionBlocks(machines.data, minuteNow)],
    [liveBookings, machines.data, minuteNow],
  );
  const [flow, setFlow] = useState<FlowState>(null);
  // Only one layout is mounted, so a phone never opens the desktop's extra listeners.
  // Before hydration both are in the HTML and CSS picks; afterwards this decides.
  const desktop = useMediaQuery(DESKTOP_QUERY);

  const pickGap = useCallback(
    (machine: Machine, start: Date) =>
      setFlow({ step: "book", machineId: machine.id, start }),
    [],
  );
  const openBooking = useCallback(
    (booking: Booking) => setFlow({ step: "details", bookingId: booking.id }),
    [],
  );
  const book = useCallback(() => setFlow({ step: "choose" }), []);

  // Something to tidy: a booking that is over, or one released because nobody came.
  const hasExpired = bookings.data.some(
    (b) => b.endAt.toMillis() <= now || isNoShow(b, now),
  );

  // Your upcoming bookings that have no notifications yet (made before they existed, or
  // while you had no device) get them now. Once per visit; the server skips the rest.
  useEffect(() => {
    if (!houseId || caughtUpFor === houseId) return;
    caughtUpFor = houseId;
    void runAction(() => catchUpNotificationsAction({ houseId })).catch(
      (error: unknown) => console.error("catch up notifications", error),
    );
  }, [houseId]);

  // Sweeping costs up to 30 reads, so it runs when there is visibly something to clear,
  // and otherwise only every few hours per browser (see /privacy for what it deletes).
  useEffect(() => {
    if (!houseId || bookings.loading) return;
    if (!shouldPrune(hasExpired)) return;
    markPruned();
    void runAction(() => pruneOldRecordsAction({ houseId })).catch((error: unknown) => {
      // Housekeeping is best effort: it runs again on the next load, and a person
      // waiting to start a wash should never be told about it.
      console.error("prune", error);
    });
  }, [houseId, bookings.loading, hasExpired]);

  const calendar = {
    machines: machines.data,
    colors,
    bookings: calendarBookings,
    loading: bookings.loading,
    onPickGap: pickGap,
    onOpenBooking: openBooking,
    onBook: book,
  };
  const ready = !machines.loading && !machines.error && machines.data.length > 0;

  return (
    <>
      {!desktop && (
        <div className="space-y-3 lg:hidden">
          <ScheduleBanner date={new Date(now)} />

          {machines.loading ? (
            // The real banner is already above; the rest of the screen holds its shape.
            <PhoneTodaySkeleton banner={false} />
          ) : machines.error ? (
            <Card size="sm">
              <CardContent>
                <LoadError what="the machines" />
              </CardContent>
            </Card>
          ) : machines.data.length === 0 ? (
            <NoMachines />
          ) : (
            machines.data.map((machine) => (
              <MachineCard
                key={machine.id}
                machine={machine}
                color={colors[machine.id]}
                bookings={liveBookings}
                now={now}
              />
            ))
          )}

          {ready && <PhoneSchedule {...calendar} now={minuteNow} />}
          {bookings.error && <LoadError what="the bookings" />}
          {ready && (
            <MyBookings
              bookings={liveBookings}
              machines={machines.data}
              colors={colors}
              now={minuteNow}
              onOpen={openBooking}
            />
          )}

          <FreshnessLine
            updatedAt={machines.updatedAt}
            fromCache={machines.fromCache}
            now={now}
          />
        </div>
      )}

      <div className="hidden lg:block">
        {machines.loading || !desktop ? (
          <DesktopTodaySkeleton />
        ) : machines.error ? (
          <LoadError what="the machines" />
        ) : machines.data.length === 0 ? (
          <NoMachines />
        ) : (
          <DesktopCalendar {...calendar} now={now} />
        )}
        {bookings.error && <LoadError what="the bookings" />}
      </div>

      <BookingFlow
        state={flow}
        onStateChange={setFlow}
        machines={machines.data}
        colors={colors}
        bookings={calendarBookings}
        now={minuteNow}
      />
    </>
  );
}

function NoMachines() {
  const { isAdmin } = useHouse();
  return (
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
