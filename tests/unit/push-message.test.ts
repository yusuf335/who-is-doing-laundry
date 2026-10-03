import { describe, expect, it } from "vitest";
import {
  BOOKING_LEAD_MINUTES,
  bookingReminderAt,
  bookingSoonPush,
  clockIn,
  cycleDonePush,
  deviceLabel,
  isPushDelivery,
  isPushTarget,
} from "@/lib/push-message";

const target = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
};

describe("isPushTarget", () => {
  it("accepts a real-looking subscription", () => {
    expect(isPushTarget(target)).toBe(true);
  });

  it("refuses anything that is not https or has odd keys", () => {
    expect(isPushTarget({ ...target, endpoint: "http://example.com/x" })).toBe(false);
    expect(isPushTarget({ ...target, endpoint: "javascript:alert(1)" })).toBe(false);
    expect(isPushTarget({ ...target, keys: { p256dh: "a b", auth: "x" } })).toBe(false);
    expect(isPushTarget({ endpoint: target.endpoint })).toBe(false);
    expect(isPushTarget(null)).toBe(false);
  });
});

describe("isPushDelivery", () => {
  const payload = cycleDonePush({ machineName: "Washer", sessionId: "s1" });

  it("accepts what the server schedules", () => {
    expect(isPushDelivery({ payload, targets: [target] })).toBe(true);
  });

  it("only links back into the app", () => {
    expect(
      isPushDelivery({
        payload: { ...payload, url: "https://evil.example" },
        targets: [],
      }),
    ).toBe(false);
  });

  it("refuses an oversized fan-out", () => {
    expect(isPushDelivery({ payload, targets: Array(11).fill(target) })).toBe(false);
  });
});

describe("wording", () => {
  it("says which machine is done", () => {
    expect(cycleDonePush({ machineName: "Dryer", sessionId: "s9" })).toEqual({
      title: "Dryer is done",
      body: "Your laundry is ready to take out.",
      tag: "cycle-s9",
      url: "/",
    });
  });

  it("gives a booking's start in the house's own time zone", () => {
    const start = new Date(Date.UTC(2026, 9, 3, 21, 45)); // 21:45 UTC
    const push = bookingSoonPush({
      machineName: "Washer",
      bookingId: "b1",
      start,
      timeZone: "America/Edmonton", // UTC-6 in October
    });
    expect(push.title).toBe(`Washer in ${BOOKING_LEAD_MINUTES} minutes`);
    expect(push.body).toBe("Your booking starts at 3:45 PM.");
  });

  it("falls back when the zone is unknown", () => {
    expect(clockIn(new Date(), "Not/AZone")).toMatch(/\d:\d\d [AP]M/);
  });
});

describe("bookingReminderAt", () => {
  const now = Date.UTC(2026, 9, 3, 12, 0);

  it("is fifteen minutes before the start", () => {
    const start = now + 60 * 60_000;
    expect(bookingReminderAt(start, now)?.getTime()).toBe(start - 15 * 60_000);
  });

  it("is skipped when the booking starts too soon to need one", () => {
    expect(bookingReminderAt(now + 15 * 60_000, now)).toBeNull();
    expect(bookingReminderAt(now + 10 * 60_000, now)).toBeNull();
  });
});

describe("deviceLabel", () => {
  it("names common devices", () => {
    expect(
      deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari"),
    ).toBe("iPhone");
    expect(
      deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/120 Mobile Safari"),
    ).toBe("Chrome on Android");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Version/17 Safari",
      ),
    ).toBe("Safari on Mac");
  });
});
