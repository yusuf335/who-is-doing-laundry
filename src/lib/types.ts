import type { Timestamp } from "firebase/firestore";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** `Date.getDay()` is Sunday-indexed; this maps it onto our weekday keys. */
export const WEEKDAY_BY_DATE_INDEX: Weekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

export type MachineType = "washer" | "dryer" | "combo";

export const MACHINE_TYPES: MachineType[] = ["washer", "dryer", "combo"];

export const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  washer: "Washer",
  dryer: "Dryer",
  combo: "All-in-one",
};

/** Said next to the type, so nobody reads "all-in-one" as a wash-then-dry job. */
export const MACHINE_TYPE_HINTS: Record<MachineType, string> = {
  washer: "Washes only.",
  dryer: "Dries only.",
  combo:
    "One drum that washes and dries. Only for a house that owns one instead of a pair.",
};

/** The house rule, in one line, wherever machines are created. */
export const MACHINE_RULE = "One card per appliance you can load at the same time.";
export type MachineStatus = "free" | "in_use";
export type MemberRole = "admin" | "member";

/** `null` means "no group owns this day", i.e. it is open to everyone. */
export type Schedule = Record<Weekday, string | null>;

/**
 * How much the day schedule matters.
 * - open:   days are ignored; anyone can start or book at any time.
 * - soft:   days say who has first claim, but a free machine is anyone's (the default).
 * - strict: only the group that owns the day can start a machine or book a slot on it.
 *   Days with no owner stay open to everyone. Nobody, not even the admin, is exempt.
 */
export type ScheduleMode = "open" | "soft" | "strict";

export const SCHEDULE_MODES: ScheduleMode[] = ["open", "soft", "strict"];

export const SCHEDULE_MODE_LABELS: Record<
  ScheduleMode,
  { title: string; description: string }
> = {
  open: {
    title: "Open to everyone",
    description:
      "Days don't count. Anyone can start an available machine or book any slot.",
  },
  soft: {
    title: "Days, shared when idle",
    description:
      "Each group has its days and first claim on them, but an available machine can be used and booked by anyone.",
  },
  strict: {
    title: "Strict days",
    description:
      "Only the group that owns the day can start a machine or book a slot on it. Days with no owner stay open.",
  },
};

export interface House {
  id: string;
  name: string;
  inviteCode: string;
  adminUid: string;
  groups: string[];
  schedule: Schedule;
  /** Missing on houses created before the setting existed; treated as "soft". */
  scheduleMode?: ScheduleMode;
  /** IANA zone the house lives in, so "today" is decided by the house, not the server. */
  timeZone?: string;
  /**
   * Whether a finished cycle also sends an email. Off unless the admin turns it on: the
   * notification is the wanted channel, and nobody needs post from a washing machine.
   */
  emailReminders?: boolean;
  /**
   * Who the reminder comes from, e.g. `Laundry <laundry@example.com>`. Not a secret, so
   * the admin sets it in settings; the API key stays server-side. The domain has to be
   * verified in Resend or the send is refused.
   */
  emailFrom?: string;
  /**
   * When true, the invite code only gets you a request; the admin decides. Off by
   * default, because for most houses the code is already the gate.
   */
  requireApproval?: boolean;
  createdAt: Timestamp | null;
}

export interface Member {
  uid: string;
  displayName: string;
  email: string;
  group: string;
  role: MemberRole;
  joinedAt: Timestamp | null;
  /**
   * Whether this person wants the reminder by email as well. Off until they ask for it,
   * and only ever sent when the admin has turned email on for the house too.
   */
  emailReminders?: boolean;
}

/** How long a finished cycle stays in the log before it is deleted automatically. */
export const SESSION_RETENTION_DAYS = 7;

/** The cycle running on a machine right now. */
export interface CurrentSession {
  /** Points at the sessions document, so ending the cycle can close the right one. */
  sessionId: string;
  uid: string;
  displayName: string;
  startedAt: Timestamp;
  expectedEndAt: Timestamp;
}

/** A named cycle length the admin configures per machine, e.g. "Heavy" = 90 min. */
export interface Cycle {
  name: string;
  minutes: number;
}

export const MAX_CYCLES_PER_MACHINE = 6;
export const ABSOLUTE_MAX_MINUTES = 600;

/** Sensible starting points; the admin edits them per machine in settings. */
export const DEFAULT_CYCLES: Record<MachineType, Cycle[]> = {
  washer: [
    { name: "Quick", minutes: 30 },
    { name: "Normal", minutes: 45 },
    { name: "Heavy", minutes: 60 },
  ],
  dryer: [
    { name: "Low", minutes: 40 },
    { name: "Normal", minutes: 60 },
    { name: "Heavy", minutes: 80 },
  ],
  combo: [
    { name: "Wash only", minutes: 45 },
    { name: "Wash + dry", minutes: 150 },
    { name: "Heavy", minutes: 180 },
  ],
};

export const DEFAULT_MAX_MINUTES: Record<MachineType, number> = {
  washer: 120,
  dryer: 120,
  combo: 240,
};

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Adding an all-in-one to a house that already has a washer or a dryer, or the reverse, is
 * almost always someone describing the same appliance twice: the app would then show the
 * same drum as busy on one card and free on another. Returns the sentence to show, or null
 * when the combination is unremarkable. Never blocks, because a flat really can own three.
 */
export function machineTypeWarning(
  type: MachineType,
  existing: Pick<Machine, "name" | "type">[],
): string | null {
  const named = (wanted: MachineType[]) =>
    existing.filter((m) => wanted.includes(m.type)).map((m) => m.name);

  if (type === "combo") {
    const separate = named(["washer", "dryer"]);
    if (separate.length === 0) return null;
    return `You already have ${listNames(separate)}. Add an all-in-one only if it is a separate appliance you can run at the same time.`;
  }

  const allInOne = named(["combo"]);
  if (allInOne.length === 0) return null;
  return `${listNames(allInOne)} already washes and dries. Add a ${MACHINE_TYPE_LABELS[type].toLowerCase()} only if it is a separate appliance you can run at the same time.`;
}

/** Cycles for a machine, falling back to the defaults for documents created before this. */
export function cyclesOf(machine: Pick<Machine, "type" | "cycles">): Cycle[] {
  return machine.cycles && machine.cycles.length > 0
    ? machine.cycles
    : DEFAULT_CYCLES[machine.type];
}

export function maxMinutesOf(machine: Pick<Machine, "type" | "maxMinutes">): number {
  return machine.maxMinutes ?? DEFAULT_MAX_MINUTES[machine.type];
}

export interface Machine {
  id: string;
  name: string;
  type: MachineType;
  status: MachineStatus;
  currentSession: CurrentSession | null;
  /** Named cycle presets shown in the Start dialog. Missing on older documents. */
  cycles?: Cycle[];
  /** Longest cycle anyone may start on this machine, for the custom field. */
  maxMinutes?: number;
  /** Display position set by the admin. Missing on older documents; see `sortMachines`. */
  order?: number;
}

/**
 * Admin-chosen order first; machines that were never ordered fall back to washers
 * before dryers, then name, the order laundry actually happens in.
 */
export function sortMachines(machines: Machine[]): Machine[] {
  return [...machines].sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name),
  );
}

function rank(machine: Machine): number {
  // Washing comes before drying; an all-in-one unit sits between the two.
  return machine.type === "washer" ? 0 : machine.type === "combo" ? 1 : 2;
}

/**
 * A finished or running cycle. Kept for a week so that whoever finds laundry sitting in
 * a machine can tell whose it is, then deleted.
 */
export interface LaundrySession {
  id: string;
  machineId: string;
  uid: string;
  displayName: string;
  startedAt: Timestamp;
  expectedEndAt: Timestamp;
  endedAt: Timestamp | null;
}

/**
 * A finished or running cycle. Kept for a week so that whoever finds laundry sitting in
 * a machine can tell whose it is, then deleted.
 */
export interface LaundrySession {
  id: string;
  machineId: string;
  uid: string;
  displayName: string;
  startedAt: Timestamp;
  expectedEndAt: Timestamp;
  endedAt: Timestamp | null;
}

export type JoinRequestStatus = "pending" | "approved" | "declined";

/** Somebody who used the invite code on a house that asks the admin first. */
export interface JoinRequest {
  uid: string;
  displayName: string;
  email: string;
  group: string;
  status: JoinRequestStatus;
  requestedAt: Timestamp | null;
  decidedAt: Timestamp | null;
}

export interface Booking {
  id: string;
  machineId: string;
  uid: string;
  displayName: string;
  startAt: Timestamp;
  endAt: Timestamp;
  createdAt: Timestamp | null;
}

/** Top-level pointer so a signed-in user can find their house in one read. */
export interface UserProfile {
  uid: string;
  houseId: string | null;
  displayName: string;
  email: string;
}

/** A machine that has run past its expected end time but has not been emptied. */
export type MachineState = "free" | "running" | "finished";

export function machineState(machine: Machine, now: number): MachineState {
  if (machine.status === "free" || !machine.currentSession) return "free";
  return machine.currentSession.expectedEndAt.toMillis() <= now ? "finished" : "running";
}

export const DEFAULT_GROUPS = ["Upstairs", "Downstairs"];

/** What a signed-in person can learn about a house from its invite code alone. */
export interface InviteLookup {
  code: string;
  houseId: string;
  houseName: string;
  groups: string[];
  /**
   * Mirrored from the house, because this document is the only thing a newcomer is
   * allowed to read. Reading it from the house itself would mean letting anyone holding
   * a houseId see every house setting.
   */
  requireApproval?: boolean;
}
