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

/** What a scheduled delivery carries: everything needed, so delivery reads nothing. */
export interface PushDelivery {
  payload: PushPayload;
  targets: PushTarget[];
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

export function isPushDelivery(value: unknown): value is PushDelivery {
  if (!value || typeof value !== "object") return false;
  const { payload, targets } = value as Partial<PushDelivery>;
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
