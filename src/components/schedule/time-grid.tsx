"use client";

import { IconLock } from "@tabler/icons-react";
import { format } from "date-fns";
import { memo, useEffect, useRef } from "react";
import { useHouse } from "@/components/providers/house-provider";
import { blockStyle } from "@/lib/machine-color";
import { dayAccess } from "@/lib/schedule";
import { formatMinutes, formatTime, sameDay, startOfDay } from "@/lib/time";
import type { Booking, Machine } from "@/lib/types";
import { cn } from "@/lib/utils";
import { blocksForDay, freeGaps, type CalendarBooking } from "@/lib/week";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(hour: number, short: boolean): string {
  if (hour === 0) return "";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  if (short) return `${h}${hour < 12 ? "a" : "p"}`;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

function shortTime(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`;
}

function at(day: Date, minute: number): Date {
  const d = startOfDay(day);
  d.setHours(0, minute, 0, 0);
  return d;
}

export interface TimeGridProps {
  days: Date[];
  /** One lane per machine inside every day, in this order. */
  machines: Machine[];
  colors: Record<string, string>;
  bookings: CalendarBooking[];
  /** Minute resolution is plenty; the grid only re-renders when this changes. */
  now: number;
  pxPerHour: number;
  /** Labels each lane with its machine; for a single day, where there is room. */
  laneLabels?: boolean;
  /** Bookings drawn in grey without a name: people the viewer has filtered out. */
  hiddenPeople?: ReadonlySet<string>;
  onPickGap: (machine: Machine, start: Date) => void;
  onOpenBooking: (booking: Booking) => void;
  /** Makes each day number a button, e.g. to open that day on its own. */
  onPickDay?: (day: Date) => void;
  className?: string;
}

/**
 * Days across, hours down, a lane per machine inside each day. Everyone's bookings are
 * blocks in the machine's colour; the dashed green gaps between them are the free time,
 * and each gap is a button that books it.
 */
export const TimeGrid = memo(function TimeGrid({
  days,
  machines,
  colors,
  bookings,
  now,
  pxPerHour,
  laneLabels = false,
  hiddenPeople,
  onPickGap,
  onOpenBooking,
  onPickDay,
  className,
}: TimeGridProps) {
  const { house, member } = useHouse();
  const today = startOfDay(new Date(now));
  const nowDate = new Date(now);
  const nowMinute = nowDate.getHours() * 60 + nowDate.getMinutes();
  const lanes = Math.max(machines.length, 1);
  // Narrow lanes get initials-sized labels; a single wide lane gets the full story.
  const roomy = days.length * lanes <= 4 || pxPerHour >= 48;
  // On a phone every pixel goes to the lanes: a slimmer hour column with "1p" labels.
  const slim = !roomy;
  const columns = {
    gridTemplateColumns: `${slim ? "2.25rem" : "3.25rem"} repeat(${days.length}, minmax(0, 1fr))`,
  };

  // Open on the current hour when today is showing, else the morning; not on midnight.
  const scrollRef = useRef<HTMLDivElement>(null);
  const showsToday = days.some((d) => sameDay(d, today));
  const firstKey = days[0]?.getTime();
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hour = showsToday ? Math.max(0, new Date().getHours() - 1) : 7;
    el.scrollTop = hour * pxPerHour;
  }, [showsToday, firstKey, pxPerHour]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="grid border-b" style={columns}>
        <div />
        {days.map((day) => {
          const access = dayAccess(house, member, day);
          const isToday = sameDay(day, today);
          return (
            <div
              key={day.getTime()}
              className="flex min-w-0 flex-col items-center gap-0.5 border-l px-0.5 pt-1.5 pb-1"
            >
              <span
                className={cn(
                  "text-[11px] font-medium tracking-wide uppercase",
                  isToday ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {format(day, "EEE")}
              </span>
              {onPickDay ? (
                <button
                  type="button"
                  onClick={() => onPickDay(day)}
                  aria-label={`Show ${format(day, "EEEE d MMMM")}`}
                  className={cn(
                    "focus-visible:ring-ring flex size-10 items-center justify-center rounded-full text-lg font-semibold tabular-nums focus-visible:ring-2 focus-visible:outline-none",
                    isToday ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {format(day, "d")}
                </button>
              ) : (
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-base font-semibold tabular-nums",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
              )}
              {access.owner && (
                <span
                  className={cn(
                    "flex max-w-full items-center gap-0.5 text-[10px]",
                    access.isOwnDay
                      ? "text-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {!access.allowed && (
                    <IconLock className="size-3 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{access.owner}</span>
                </span>
              )}
              {laneLabels ? (
                <div className="mt-1 grid w-full gap-1 px-1" style={laneColumns(lanes)}>
                  {machines.map((m) => (
                    <span
                      key={m.id}
                      className="flex min-w-0 items-center justify-center gap-1.5 text-xs font-medium"
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: colors[m.id] }}
                        aria-hidden
                      />
                      <span className="truncate">{m.name}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-0.5 flex w-full gap-0.5 px-0.5" aria-hidden>
                  {machines.map((m) => (
                    <span
                      key={m.id}
                      className="h-1 flex-1 rounded-full"
                      style={{ backgroundColor: colors[m.id] }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative grid" style={{ ...columns, height: 24 * pxPerHour }}>
          <div className="relative" aria-hidden>
            {HOURS.map((hour) => (
              <span
                key={hour}
                className="text-muted-foreground absolute right-1.5 -translate-y-1/2 text-[10px] whitespace-nowrap tabular-nums"
                style={{ top: hour * pxPerHour }}
              >
                {hourLabel(hour, slim)}
              </span>
            ))}
          </div>

          {days.map((day) => {
            const access = dayAccess(house, member, day);
            const isToday = sameDay(day, today);
            const pastMinutes = isToday ? nowMinute : day < today ? 24 * 60 : 0;
            return (
              <div
                key={day.getTime()}
                className="relative border-l"
                style={{
                  backgroundImage:
                    "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
                  backgroundSize: `100% ${pxPerHour}px`,
                }}
              >
                {pastMinutes > 0 && (
                  <div
                    aria-hidden
                    className="bg-muted/60 pointer-events-none absolute inset-x-0 top-0"
                    style={{ height: (pastMinutes / 60) * pxPerHour }}
                  />
                )}
                {!access.allowed && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,var(--muted)_0_6px,transparent_6px_12px)]"
                  />
                )}

                <div
                  className="absolute inset-0 grid gap-0.5 px-0.5"
                  style={laneColumns(lanes)}
                >
                  {machines.map((machine) => (
                    <Lane
                      key={machine.id}
                      day={day}
                      machine={machine}
                      color={colors[machine.id]}
                      bookings={bookings}
                      now={now}
                      pxPerHour={pxPerHour}
                      roomy={roomy}
                      single={days.length === 1}
                      bookable={access.allowed}
                      mineUid={member?.uid}
                      hiddenPeople={hiddenPeople}
                      onPickGap={onPickGap}
                      onOpenBooking={onOpenBooking}
                    />
                  ))}
                </div>

                {isToday && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-red-500"
                    style={{ top: (nowMinute / 60) * pxPerHour }}
                  >
                    <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

function laneColumns(lanes: number): React.CSSProperties {
  return { gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))` };
}

function Lane({
  day,
  machine,
  color,
  bookings,
  now,
  pxPerHour,
  roomy,
  single,
  bookable,
  mineUid,
  hiddenPeople,
  onPickGap,
  onOpenBooking,
}: {
  day: Date;
  machine: Machine;
  color: string;
  bookings: CalendarBooking[];
  now: number;
  pxPerHour: number;
  roomy: boolean;
  /** A day on its own: wide lanes, room to say how long each gap is. */
  single: boolean;
  bookable: boolean;
  mineUid: string | undefined;
  hiddenPeople?: ReadonlySet<string>;
  onPickGap: (machine: Machine, start: Date) => void;
  onOpenBooking: (booking: Booking) => void;
}) {
  const y = (minute: number) => (minute / 60) * pxPerHour;
  const dayLabel = format(day, "EEEE d MMMM");

  return (
    <div className="relative min-w-0">
      {bookable &&
        freeGaps(bookings, machine.id, day, now).map((gap) => {
          const height = y(gap.endMinute) - y(gap.startMinute);
          const start = at(day, gap.startMinute);
          return (
            <button
              key={gap.startMinute}
              type="button"
              onClick={() => onPickGap(machine, start)}
              aria-label={`${machine.name} free on ${dayLabel} from ${formatTime(start)} to ${formatTime(at(day, gap.endMinute))}. Book it.`}
              className="absolute inset-x-0 z-[1] overflow-hidden rounded-md border border-dashed border-emerald-400/70 bg-emerald-50/50 px-1 pt-0.5 text-left text-[10px] font-medium text-ellipsis whitespace-nowrap text-emerald-800 transition-colors hover:bg-emerald-100/80 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:outline-none dark:border-emerald-500/40 dark:bg-emerald-500/5 dark:text-emerald-300 dark:hover:bg-emerald-500/15"
              style={{ top: y(gap.startMinute) + 1, height: Math.max(height - 2, 4) }}
            >
              {height >= 24 &&
                (single
                  ? `Free · ${formatMinutes(gap.endMinute - gap.startMinute)}`
                  : "Free")}
            </button>
          );
        })}

      {blocksForDay(bookings, machine.id, day).map((block) => {
        const { booking } = block;
        const mine = booking.uid === mineUid;
        const hidden = !mine && hiddenPeople?.has(booking.uid);
        const past = booking.endAt.toMillis() <= now;
        const height = y(block.endMinute) - y(block.startMinute);
        const name = mine ? "You" : booking.displayName;
        const who = (booking as CalendarBooking).inUse ? `${name} · in use` : name;
        return (
          <button
            key={booking.id}
            type="button"
            onClick={() => onOpenBooking(booking)}
            aria-label={`${who}, ${machine.name}, ${dayLabel}, ${formatTime(booking.startAt.toDate())} to ${formatTime(booking.endAt.toDate())}`}
            className={cn(
              "focus-visible:ring-ring absolute inset-x-0 z-10 overflow-hidden rounded-md px-1 py-0.5 text-left leading-tight focus-visible:ring-2 focus-visible:outline-none",
              roomy ? "text-xs" : "text-[10px]",
              block.continued && "rounded-t-none",
              hidden &&
                "bg-muted text-muted-foreground ring-foreground/10 ring-1 ring-inset",
              past && "opacity-50",
            )}
            style={{
              top: y(block.startMinute) + 1,
              // Even a 15-minute booking stays big enough to tap.
              height: Math.max(height - 2, 14),
              ...(hidden ? {} : blockStyle(color, mine)),
            }}
          >
            {height >= 14 && (
              <span className="block truncate font-semibold">
                {hidden ? "Booked" : who}
              </span>
            )}
            {roomy && height >= 32 && (
              <span className="block truncate tabular-nums opacity-85">
                {shortTime(block.startMinute)}–{shortTime(block.endMinute)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
