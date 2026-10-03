/**
 * What a phone notification says and when it goes out. Pure, so the server, the
 * delivery endpoint and the tests all agree.
 */

/** The text of one notification, as the service worker shows it. */
export interface PushPayload {
  title: string;
  body: string;
  /** A later notification with the same tag replaces this one instead of stacking. */
  tag: string;
  /** Where tapping the notification takes you. */
  url: string;
}

/** One browser's Web Push subscription, as `PushSubscription.toJSON()` gives it. */
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * A finished cycle that has not been emptied keeps reminding its owner. Each delivery
 * schedules the next one; emptying the machine cancels whatever is still waiting.
 */
export interface PushChase {
  machineName: string;
  sessionId: string;
  /** When the cycle finished, so each reminder can say how long it has been. */
  finishedAt: number;
  /** Reminders still allowed after this one. */
  remaining: number;
}

/** A fully rendered email, sent as-is when the delivery comes due. */
export interface RenderedEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** What a scheduled delivery carries: everything needed, so delivery reads nothing. */
export interface PushDelivery {
  payload: PushPayload;
  targets: PushTarget[];
  chase?: PushChase;
  /**
   * An email to send at the same moment. It rides in the same message so that whatever
   * cancels the notification (starting the machine, cancelling the booking) cancels the
   * email too.
   */
  email?: RenderedEmail;
}

function isRenderedEmail(value: unknown): value is RenderedEmail {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<RenderedEmail>;
  const short = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 300;
  return (
    short(e.from) &&
    short(e.to) &&
    short(e.subject) &&
    typeof e.text === "string" &&
    e.text.length <= 20_000 &&
    typeof e.html === "string" &&
    e.html.length <= 100_000
  );
}

/** How often a finished, unemptied machine reminds its owner. */
export const CHASE_EVERY_MINUTES = 15;

/** At most twelve hours of reminders, so a forgotten machine cannot run up the quota. */
export const MAX_CHASES = (12 * 60) / CHASE_EVERY_MINUTES;

/** The label every notification about one cycle carries, so all can be cancelled at once. */
export function cycleLabel(sessionId: string): string {
  return `cycle-${sessionId}`;
}

/** How long before a booking its reminder goes out. */
export const BOOKING_LEAD_MINUTES = 15;

/** At most this many devices per person, so one account cannot fan out a delivery. */
export const MAX_PUSH_DEVICES = 10;

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Whether `value` is a subscription worth storing. Push services all use https; the keys
 * are short base64url strings. Anything else is refused before it reaches the database.
 */
export function isPushTarget(value: unknown): value is PushTarget {
  if (!value || typeof value !== "object") return false;
  const { endpoint, keys } = value as Partial<PushTarget>;
  return (
    typeof endpoint === "string" &&
    endpoint.length <= 1000 &&
    endpoint.startsWith("https://") &&
    !!keys &&
    typeof keys.p256dh === "string" &&
    keys.p256dh.length <= 200 &&
    BASE64URL.test(keys.p256dh) &&
    typeof keys.auth === "string" &&
    keys.auth.length <= 100 &&
    BASE64URL.test(keys.auth)
  );
}

function isPushChase(value: unknown): value is PushChase {
  if (!value || typeof value !== "object") return false;
  const { machineName, sessionId, finishedAt, remaining } = value as Partial<PushChase>;
  return (
    typeof machineName === "string" &&
    machineName.length <= 100 &&
    typeof sessionId === "string" &&
    /^[A-Za-z0-9_-]{1,100}$/.test(sessionId) &&
    typeof finishedAt === "number" &&
    Number.isFinite(finishedAt) &&
    Number.isInteger(remaining) &&
    remaining! >= 0 &&
    remaining! <= MAX_CHASES
  );
}

export function isPushDelivery(value: unknown): value is PushDelivery {
  if (!value || typeof value !== "object") return false;
  const { payload, targets, chase, email } = value as Partial<PushDelivery>;
  if (chase !== undefined && !isPushChase(chase)) return false;
  if (email !== undefined && !isRenderedEmail(email)) return false;
  return (
    !!payload &&
    typeof payload.title === "string" &&
    typeof payload.body === "string" &&
    typeof payload.tag === "string" &&
    typeof payload.url === "string" &&
    payload.url.startsWith("/") &&
    Array.isArray(targets) &&
    targets.length <= MAX_PUSH_DEVICES &&
    targets.every(isPushTarget)
  );
}

/**
 * "3:45 PM" in the house's own zone. The server runs in UTC, so the plain local-time
 * formatter would print the wrong hour there.
 */
export function clockIn(date: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(date);
  } catch {
    // Unknown zone: the process clock is better than nothing.
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
}

export function cycleDonePush(input: {
  machineName: string;
  sessionId: string;
}): PushPayload {
  return {
    title: `${input.machineName} is done`,
    body: "Your laundry is ready to take out.",
    tag: `cycle-${input.sessionId}`,
    url: "/",
  };
}

/** The repeat while a finished machine waits to be emptied. Same tag: it replaces the last. */
export function stillWaitingPush(input: {
  machineName: string;
  sessionId: string;
  minutesWaiting: number;
}): PushPayload {
  const minutes = Math.max(1, Math.round(input.minutesWaiting));
  const waited =
    minutes < 60
      ? `${minutes} min`
      : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return {
    title: `${input.machineName} is still waiting`,
    body: `Your laundry finished ${waited} ago. Empty it so the next person can use it.`,
    tag: `cycle-${input.sessionId}`,
    url: "/",
  };
}

/** Somebody other than the owner emptied (or stopped) a machine: both are told. */
export function emptiedPush(input: {
  to: "owner" | "emptier";
  ownerName: string;
  emptierName: string;
  machineName: string;
  sessionId: string;
  at: Date;
  stopped: boolean;
  timeZone?: string;
}): PushPayload {
  const verb = input.stopped ? "stopped" : "emptied";
  const first = (name: string) => name.trim().split(/\s+/)[0] || name;
  const time = clockIn(input.at, input.timeZone);
  return input.to === "owner"
    ? {
        title: `${first(input.emptierName)} ${verb} your ${input.machineName}`,
        body: input.stopped
          ? `Stopped at ${time} before it finished. Your laundry may still be inside.`
          : `Your laundry was taken out at ${time}.`,
        // Replaces the "still waiting" reminder for the same cycle.
        tag: `cycle-${input.sessionId}`,
        url: "/history",
      }
    : {
        title: `You ${verb} ${first(input.ownerName)}'s ${input.machineName}`,
        body: `${first(input.ownerName)} has been told.`,
        tag: `emptied-${input.sessionId}`,
        url: "/history",
      };
}

/** How often the booker is nudged once their booking has started. */
export const NUDGE_EVERY_MINUTES = 5;

/** Everything about one booking carries this label, so it can be cancelled at once. */
export function bookingLabel(bookingId: string): string {
  return `booking-${bookingId}`;
}

/** At the start and every few minutes after: start it, or it is released. */
export function bookingStartedPush(input: {
  machineName: string;
  bookingId: string;
  minutesLeft: number;
}): PushPayload {
  return {
    title: `Your ${input.machineName} booking has started`,
    body: `Start it within ${input.minutesLeft} min or the slot is released for others.`,
    tag: `booking-${input.bookingId}`,
    url: "/",
  };
}

/** The booking lapsed because nobody started the machine. */
export function bookingReleasedPush(input: {
  machineName: string;
  bookingId: string;
  releasedAt: Date;
  timeZone?: string;
}): PushPayload {
  return {
    title: `${input.machineName} booking released`,
    body: `You did not start it by ${clockIn(input.releasedAt, input.timeZone)}, so the slot is free for others.`,
    tag: `booking-${input.bookingId}`,
    url: "/",
  };
}

export function bookingSoonPush(input: {
  machineName: string;
  bookingId: string;
  start: Date;
  timeZone?: string;
}): PushPayload {
  return {
    title: `${input.machineName} in ${BOOKING_LEAD_MINUTES} minutes`,
    body: `Your booking starts at ${clockIn(input.start, input.timeZone)}.`,
    tag: `booking-${input.bookingId}`,
    url: "/",
  };
}

/**
 * When the "starts soon" reminder should go out, or null when it would be pointless:
 * a booking made with less than a few minutes to go needs no reminder.
 */
export function bookingReminderAt(startMs: number, now: number): Date | null {
  const at = startMs - BOOKING_LEAD_MINUTES * 60_000;
  return at - now >= 60_000 ? new Date(at) : null;
}

/** A short name for a device in settings, e.g. "iPhone" or "Chrome on Mac". */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  const os = ua.includes("android")
    ? "Android"
    : ua.includes("mac os")
      ? "Mac"
      : ua.includes("windows")
        ? "Windows"
        : ua.includes("linux")
          ? "Linux"
          : "this device";
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("firefox")
      ? "Firefox"
      : ua.includes("chrome")
        ? "Chrome"
        : ua.includes("safari")
          ? "Safari"
          : "Browser";
  return `${browser} on ${os}`;
}
