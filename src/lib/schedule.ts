import type { House, Member, Schedule, ScheduleMode } from "@/lib/types";
import { WEEKDAYS, WEEKDAY_LABELS } from "@/lib/types";
import { weekdayOf } from "@/lib/time";

export function emptySchedule(): Schedule {
  return Object.fromEntries(WEEKDAYS.map((day) => [day, null])) as Schedule;
}

/**
 * Alternates the given groups across the week, which is the arrangement most houses
 * start from. Admins can rearrange it afterwards in settings.
 */
export function defaultSchedule(groups: string[]): Schedule {
  const schedule = emptySchedule();
  if (groups.length === 0) return schedule;
  WEEKDAYS.forEach((day, index) => {
    schedule[day] = index === 6 ? null : groups[index % groups.length];
  });
  return schedule;
}

export function scheduleModeOf(house: Pick<House, "scheduleMode"> | null): ScheduleMode {
  return house?.scheduleMode ?? "soft";
}

export function groupForDate(
  schedule: Schedule,
  date: Date,
  timeZone?: string,
): string | null {
  return schedule[weekdayOf(date, timeZone)] ?? null;
}

export function dayLabel(date: Date, timeZone?: string): string {
  return WEEKDAY_LABELS[weekdayOf(date, timeZone)];
}

export interface DayAccess {
  mode: ScheduleMode;
  /** Group that owns the day, or null when the day is open (or the mode ignores days). */
  owner: string | null;
  /** True when the member's group owns the day, or nobody does. */
  isOwnDay: boolean;
  /** Whether this member may start a machine or book a slot on this day. */
  allowed: boolean;
  /** Why not, when `allowed` is false. */
  reason: string | null;
}

/**
 * The single place that decides what a day means for a member. The server calls it before
 * starting a cycle or creating a booking; the UI calls it to explain or disable buttons.
 * In "strict" mode the day the action starts on decides; a booking may run past midnight.
 */
export function dayAccess(
  house: House | null,
  member: Member | null,
  date: Date,
): DayAccess {
  const mode = scheduleModeOf(house);
  if (!house || mode === "open") {
    return { mode, owner: null, isOwnDay: true, allowed: true, reason: null };
  }

  const owner = groupForDate(house.schedule, date, house.timeZone);
  const isOwnDay = !owner || (member != null && member.group === owner);
  if (mode === "soft" || isOwnDay) {
    return { mode, owner, isOwnDay, allowed: true, reason: null };
  }

  return {
    mode,
    owner,
    isOwnDay: false,
    allowed: false,
    reason: `${dayLabel(date, house.timeZone)} is ${owner} day. Only ${owner} can start a machine or book a slot on it.`,
  };
}

/** Banner copy for the dashboard. Returns null when the schedule is switched off. */
export function scheduleNoticeFor(
  house: House | null,
  member: Member | null,
  date: Date,
): {
  mode: ScheduleMode;
  owner: string | null;
  isOwnDay: boolean;
  message: string;
} | null {
  const access = dayAccess(house, member, date);
  if (access.mode === "open") return null;
  const day = dayLabel(date, house?.timeZone);

  if (!access.owner) {
    return { ...access, message: `${day} is open to everyone.` };
  }
  if (access.mode === "strict") {
    return {
      ...access,
      message: `${day} is ${access.owner} day. Only ${access.owner} can start or book today.`,
    };
  }
  return {
    ...access,
    message: `${day} is ${access.owner} day. If a machine is available, anyone can use it.`,
  };
}
