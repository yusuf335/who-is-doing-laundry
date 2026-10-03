"use client";

import { IconCalendarEvent, IconChevronRight } from "@tabler/icons-react";
import { useHouse } from "@/components/providers/house-provider";
import { formatDayAndTime, formatTime } from "@/lib/time";
import type { Booking, Machine } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Everything you have booked from now on, any machine, any day. The calendar only shows
 * a few days at a time, so without this a booking next week is easy to lose.
 */
export function MyBookings({
  bookings,
  machines,
  colors,
  now,
  onOpen,
  className,
}: {
  bookings: Booking[];
  machines: Machine[];
  colors: Record<string, string>;
  now: number;
  onOpen: (booking: Booking) => void;
  className?: string;
}) {
  const { member } = useHouse();
  const mine = bookings
    .filter((b) => b.uid === member?.uid && b.endAt.toMillis() > now)
    .sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis());

  return (
    <section
      aria-labelledby="my-bookings-heading"
      className={cn(
        "bg-card ring-foreground/10 rounded-xl px-3 py-2.5 ring-1",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="my-bookings-heading" className="text-sm font-semibold">
          Your bookings
        </h2>
        {mine.length > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {mine.length} upcoming
          </span>
        )}
      </div>

      {mine.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
          <IconCalendarEvent className="size-4" aria-hidden />
          Nothing booked. Tap a free time to book one.
        </p>
      ) : (
        <ul className="mt-1 divide-y">
          {mine.map((booking) => {
            const machine = machines.find((m) => m.id === booking.machineId);
            const start = booking.startAt.toDate();
            return (
              <li key={booking.id}>
                <button
                  type="button"
                  onClick={() => onOpen(booking)}
                  className="hover:bg-muted/50 focus-visible:ring-ring -mx-1 flex min-h-12 w-[calc(100%+0.5rem)] items-center gap-3 rounded-md px-1 text-left focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: colors[booking.machineId] ?? "#737373" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium tabular-nums first-letter:uppercase">
                      {formatDayAndTime(start, new Date(now))} to{" "}
                      {formatTime(booking.endAt.toDate())}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {machine?.name ?? "Removed machine"}
                    </span>
                  </span>
                  <IconChevronRight
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
