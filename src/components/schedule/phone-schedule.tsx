"use client";

import { IconChevronLeft, IconChevronRight, IconPlus } from "@tabler/icons-react";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { TimeGrid } from "@/components/schedule/time-grid";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, latestBookingStart, startOfDay } from "@/lib/time";
import type { Booking, Machine } from "@/lib/types";
import { visibleDays } from "@/lib/week";

const DAYS_SHOWN = 3;

/** Three days at a time, every machine in its own coloured lane, free time tappable. */
export function PhoneSchedule({
  machines,
  colors,
  bookings,
  loading,
  now,
  onPickGap,
  onOpenBooking,
  onBook,
}: {
  machines: Machine[];
  colors: Record<string, string>;
  bookings: Booking[];
  loading: boolean;
  now: number;
  onPickGap: (machine: Machine, start: Date) => void;
  onOpenBooking: (booking: Booking) => void;
  onBook: () => void;
}) {
  const [page, setPage] = useState(0);
  const todayMs = startOfDay(new Date(now)).getTime();
  // Memoised so the grid, which skips re-rendering on equal props, keeps doing so.
  const days = useMemo(
    () => visibleDays(addDays(new Date(todayMs), page * DAYS_SHOWN), DAYS_SHOWN),
    [todayMs, page],
  );
  const first = days[0];
  const last = days[days.length - 1];
  const range =
    first.getMonth() === last.getMonth()
      ? `${format(first, "d")} to ${format(last, "d MMM")}`
      : `${format(first, "d MMM")} to ${format(last, "d MMM")}`;

  return (
    <section
      aria-label="Schedule"
      className="bg-card ring-foreground/10 flex flex-col overflow-hidden rounded-xl ring-1"
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={`Previous ${DAYS_SHOWN} days`}
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          <IconChevronLeft />
        </Button>
        <p className="min-w-0 flex-1 text-center text-sm font-semibold tabular-nums">
          {page === 0 ? `Today to ${format(last, "EEE d MMM")}` : range}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={`Next ${DAYS_SHOWN} days`}
          // Bookings open two weeks ahead; there is nothing to see past that.
          disabled={addDays(last, 1).getTime() > latestBookingStart(now)}
          onClick={() => setPage(page + 1)}
        >
          <IconChevronRight />
        </Button>
        <Button variant="outline" className="h-10 px-3" onClick={onBook}>
          <IconPlus />
          Book
        </Button>
      </div>

      {loading ? (
        <Skeleton className="m-2 h-80" />
      ) : (
        <TimeGrid
          className="h-[min(62svh,34rem)] min-h-72 border-t"
          days={days}
          machines={machines}
          colors={colors}
          bookings={bookings}
          now={now}
          pxPerHour={44}
          onPickGap={onPickGap}
          onOpenBooking={onOpenBooking}
        />
      )}

      <Legend machines={machines} colors={colors} />
    </section>
  );
}

export function Legend({
  machines,
  colors,
}: {
  machines: Machine[];
  colors: Record<string, string>;
}) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-[11px]">
      {machines.map((m) => (
        <span key={m.id} className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: colors[m.id] }}
            aria-hidden
          />
          {m.name}
        </span>
      ))}
      <span>Solid is yours</span>
      <span className="flex items-center gap-1.5">
        <span
          className="size-2.5 rounded-sm border border-dashed border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
          aria-hidden
        />
        Free, tap to book
      </span>
    </div>
  );
}
