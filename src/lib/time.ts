import { format } from "date-fns";
import { WEEKDAY_BY_DATE_INDEX, type Weekday } from "@/lib/types";

export const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * 60_000;
export const MAX_BOOKING_MINUTES = 6 * 60;
/**
 * How far ahead a booking may start, in whole days: today plus this many more. Keeps
 * the fortnight ahead fair for everyone.
 */
export const MAX_DAYS_AHEAD = 14;

/** The latest moment a booking made at `now` may start: the end of the last open day. */
export function latestBookingStart(now: number): number {
  return addDays(startOfDay(new Date(now)), MAX_DAYS_AHEAD + 1).getTime() - 1;
}

/**
 * The server's version of the limit. It runs in UTC and cannot know where the house's
 * midnight falls, so it allows one extra day; the app holds people to whole days.
 */
export const SERVER_MAX_AHEAD_MS = (MAX_DAYS_AHEAD + 1) * 24 * 60 * 60_000;

/**
 * The weekday `date` falls on. With a time zone, the answer is for that zone (the house's),
 * which matters on the server where the process clock is UTC.
 */
export function weekdayOf(date: Date, timeZone?: string): Weekday {
  if (timeZone) {
    try {
      const short = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone })
        .format(date)
        .toLowerCase()
        .slice(0, 3) as Weekday;
      if (WEEKDAY_BY_DATE_INDEX.includes(short)) return short;
    } catch {
      // Unknown zone: fall through to the process-local answer.
    }
  }
  return WEEKDAY_BY_DATE_INDEX[date.getDay()];
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Alberta has stayed on UTC-6 all year since its Official Time Act (18 June 2026); the
 * clocks no longer go back on 1 November 2026. America/Edmonton only learns this in tzdata
 * 2026c, which many browsers and servers do not ship yet, so Alberta is stored as the fixed
 * UTC-6 zone instead. (Etc zones flip the sign: Etc/GMT+6 is UTC-6.)
 */
export const ALBERTA_TIME_ZONE = "Etc/GMT+6";

/** Canada's zones by province and territory, west to east, offered first in settings. */
export const CANADIAN_TIME_ZONES: { zone: string; label: string }[] = [
  { zone: "America/Vancouver", label: "British Columbia (Pacific)" },
  { zone: "America/Dawson_Creek", label: "Northeast British Columbia and Creston" },
  { zone: "America/Whitehorse", label: "Yukon" },
  { zone: ALBERTA_TIME_ZONE, label: "Alberta" },
  { zone: "America/Edmonton", label: "Northwest Territories (Mountain)" },
  { zone: "America/Cambridge_Bay", label: "Western Nunavut" },
  { zone: "America/Regina", label: "Saskatchewan" },
  { zone: "America/Winnipeg", label: "Manitoba and northwestern Ontario (Central)" },
  { zone: "America/Rankin_Inlet", label: "Central Nunavut" },
  { zone: "America/Atikokan", label: "Atikokan and Southampton Island" },
  { zone: "America/Toronto", label: "Ontario and Quebec (Eastern)" },
  { zone: "America/Iqaluit", label: "Eastern Nunavut" },
  { zone: "America/Halifax", label: "Nova Scotia, New Brunswick, PEI (Atlantic)" },
  { zone: "America/Goose_Bay", label: "Labrador" },
  { zone: "America/Blanc-Sablon", label: "Blanc-Sablon, Quebec" },
  { zone: "America/St_Johns", label: "Newfoundland" },
];

/** How a zone is named in the app: "Alberta" for Canada's, "America/New York" otherwise. */
export function timeZoneLabel(zone: string): string {
  return (
    CANADIAN_TIME_ZONES.find((option) => option.zone === zone)?.label ??
    zone.replace(/_/g, " ")
  );
}

/** The zone this device is set to; used as the house default when it is created. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Rounds down to the nearest bookable slot boundary. */
export function snapToSlot(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES);
  return d;
}

/** "14:30" -> a Date on `day` at that time. */
export function atTime(day: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const d = startOfDay(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/** Every "HH:mm" on a 15-minute grid across a day. */
export function slotTimeOptions(): string[] {
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += SLOT_MINUTES) {
    const h = String(Math.floor(minutes / 60)).padStart(2, "0");
    const m = String(minutes % 60).padStart(2, "0");
    options.push(`${h}:${m}`);
  }
  return options;
}

/**
 * Deterministic id shared by everyone booking the same machine and quarter hour. It is
 * derived from the epoch rather than wall-clock time so a DST change can never make two
 * different moments collide, or one moment map to two ids.
 */
export function slotId(machineId: string, slotStart: Date): string {
  return `${machineId}_${Math.floor(slotStart.getTime() / SLOT_MS)}`;
}

/** The slot ids a booking occupies. End is exclusive, so 10:00-11:00 takes four slots. */
export function slotIdsForRange(machineId: string, start: Date, end: Date): string[] {
  const ids: string[] = [];
  for (
    let cursor = new Date(start);
    cursor < end;
    cursor = addMinutes(cursor, SLOT_MINUTES)
  ) {
    ids.push(slotId(machineId, cursor));
  }
  return ids;
}

/** "3:30 PM" style, which is how the house reads a clock. */
export function formatTime(date: Date): string {
  return format(date, "h:mm a");
}

/** Cycle lengths are arbitrary minutes; bookings sit on the grid, so round up to it. */
export function roundUpToSlot(minutes: number): number {
  return Math.ceil(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

/** The 24-hour "HH:mm" grid value for a date; the form's option values use this shape. */
export function slotValue(date: Date): string {
  return format(date, "HH:mm");
}

/** Label for an "HH:mm" grid value, e.g. "15:30" -> "3:30 PM". The value itself stays 24h. */
export function formatSlotLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatDayAndTime(date: Date, today = new Date()): string {
  if (sameDay(date, today)) return `today ${formatTime(date)}`;
  if (sameDay(date, addDays(today, 1))) return `tomorrow ${formatTime(date)}`;
  return format(date, "EEE d MMM h:mm a");
}

/** "1h 05m" / "12m" / "40s": the countdown shown on a running machine. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
