import { Timestamp } from "firebase/firestore";
import { SLOT_MINUTES, addDays, latestBookingStart, startOfDay } from "@/lib/time";
import type { Booking, Machine } from "@/lib/types";

export const DAY_MINUTES = 24 * 60;

/** A booking, or a running cycle drawn like one (`inUse`), as the calendar shows it. */
export type CalendarBooking = Booking & { inUse?: boolean };

const SLOT_MS = SLOT_MINUTES * 60_000;

/**
 * Cycles running right now, shaped like bookings so the calendar never offers their time
 * as free. A cycle that has finished but not been emptied holds the machine until the
 * next quarter hour, which is the soonest anyone could book it anyway.
 */
export function sessionBlocks(machines: Machine[], now: number): CalendarBooking[] {
  return machines.flatMap((machine) => {
    const session = machine.status === "in_use" ? machine.currentSession : null;
    if (!session) return [];
    const until = Math.max(
      session.expectedEndAt.toMillis(),
      Math.ceil(now / SLOT_MS) * SLOT_MS,
    );
    return [
      {
        id: `session:${machine.id}`,
        machineId: machine.id,
        uid: session.uid,
        displayName: session.displayName,
        startAt: session.startedAt,
        endAt: Timestamp.fromMillis(until),
        createdAt: null,
        inUse: true,
      },
    ];
  });
}

/** `count` consecutive local midnights starting from the day `start` falls on. */
export function visibleDays(start: Date, count: number): Date[] {
  const first = startOfDay(start);
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

/** The part of a booking that falls on one day, as minutes past that day's midnight. */
export interface DayBlock {
  booking: Booking;
  startMinute: number;
  endMinute: number;
  /** The booking began the day before and carries on into this one. */
  continued: boolean;
}

/** Wall-clock minutes past `day`'s midnight, capped at the end of the day. */
function minuteOn(day: Date, ms: number): number {
  const dayStart = startOfDay(day).getTime();
  if (ms <= dayStart) return 0;
  if (ms >= addDays(startOfDay(day), 1).getTime()) return DAY_MINUTES;
  // From the clock rather than the elapsed time, so a 23 or 25 hour DST day still lines
  // up with the hour labels.
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * The bookings on one machine that touch `day`, clipped to that day. A booking that runs
 * past midnight shows up on both days, so the grid never hides time that is taken.
 */
export function blocksForDay(
  bookings: Booking[],
  machineId: string,
  day: Date,
): DayBlock[] {
  const dayStartMs = startOfDay(day).getTime();
  const dayEndMs = addDays(startOfDay(day), 1).getTime();

  return bookings
    .filter(
      (b) =>
        b.machineId === machineId &&
        b.startAt.toMillis() < dayEndMs &&
        b.endAt.toMillis() > dayStartMs,
    )
    .map((b) => ({
      booking: b,
      startMinute: minuteOn(day, b.startAt.toMillis()),
      endMinute: minuteOn(day, b.endAt.toMillis()),
      continued: b.startAt.toMillis() < dayStartMs,
    }))
    .filter((block) => block.endMinute > block.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute);
}

export interface Gap {
  startMinute: number;
  endMinute: number;
}

/** Rounds up to the next 15-minute boundary. */
function slotCeil(minute: number): number {
  return Math.ceil(minute / SLOT_MINUTES) * SLOT_MINUTES;
}

/**
 * The open stretches on one machine on `day`, from `now` onwards when `day` is today.
 * Each one starts on the booking grid and is at least `minMinutes` long.
 */
export function freeGaps(
  bookings: Booking[],
  machineId: string,
  day: Date,
  now: number,
  minMinutes = SLOT_MINUTES,
): Gap[] {
  const blocks = blocksForDay(bookings, machineId, day);
  let cursor = slotCeil(minuteOn(day, now));
  // Nothing past the booking horizon is offered: the day it falls on is cut short there.
  const limit = Math.min(DAY_MINUTES, minuteOn(day, latestBookingStart(now) + 1));
  if (cursor >= limit) return [];

  const gaps: Gap[] = [];
  for (const block of [...blocks, { startMinute: DAY_MINUTES, endMinute: DAY_MINUTES }]) {
    const gapEnd = Math.min(block.startMinute, limit);
    if (gapEnd - cursor >= minMinutes) {
      gaps.push({ startMinute: cursor, endMinute: gapEnd });
    }
    cursor = Math.max(cursor, slotCeil(block.endMinute));
    if (cursor >= limit) break;
  }
  return gaps;
}

/**
 * The soonest start on `machineId` with room for `minutes`, looking `days` days ahead
 * from today. Null when every day is full.
 */
export function nextFreeSlot(
  bookings: Booking[],
  machineId: string,
  now: number,
  minutes: number,
  days = 7,
  canUse: (day: Date) => boolean = () => true,
): Date | null {
  for (const day of visibleDays(new Date(now), days)) {
    if (!canUse(day)) continue;
    const gap = freeGaps(bookings, machineId, day, now, minutes)[0];
    if (gap) {
      const start = startOfDay(day);
      start.setHours(0, gap.startMinute, 0, 0);
      return start;
    }
  }
  return null;
}

/** The first booking on `machineId` that a new start..end range would collide with. */
export function firstOverlap(
  bookings: Booking[],
  machineId: string,
  start: Date,
  end: Date,
): Booking | null {
  return (
    bookings.find(
      (b) =>
        b.machineId === machineId &&
        b.startAt.toMillis() < end.getTime() &&
        b.endAt.toMillis() > start.getTime(),
    ) ?? null
  );
}

/** The next booking on `machineId` starting at or after `from`, for "free until …". */
export function nextBookingAfter(
  bookings: Booking[],
  machineId: string,
  from: Date,
): Booking | null {
  return (
    bookings
      .filter((b) => b.machineId === machineId && b.startAt.toMillis() >= from.getTime())
      .sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis())[0] ?? null
  );
}

/**
 * Every start on the 15-minute grid on `day` where a `minutes`-long booking on
 * `machineId` would be in the future and overlap nobody. What the start-time list offers.
 */
export function validStarts(
  bookings: Booking[],
  machineId: string,
  day: Date,
  now: number,
  minutes: number,
): Date[] {
  const starts: Date[] = [];
  const seen = new Set<number>();
  for (let minute = 0; minute < DAY_MINUTES; minute += SLOT_MINUTES) {
    const start = startOfDay(day);
    start.setHours(0, minute, 0, 0);
    // A DST jump can land two grid points on one moment, or push one into the next day.
    if (seen.has(start.getTime()) || start.getDate() !== day.getDate()) continue;
    seen.add(start.getTime());
    if (start.getTime() < now || start.getTime() > latestBookingStart(now)) continue;
    const end = new Date(start.getTime() + minutes * 60_000);
    if (!firstOverlap(bookings, machineId, start, end)) starts.push(start);
  }
  return starts;
}
