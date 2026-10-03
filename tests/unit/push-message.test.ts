import { describe, expect, it } from "vitest";
import {
  BOOKING_LEAD_MINUTES,
  MAX_CHASES,
  bookingReminderAt,
  bookingSoonPush,
  cycleLabel,
  clockIn,
  cycleDonePush,
  deviceLabel,
  emptiedPush,
  bookingLabel,
  bookingReleasedPush,
  bookingStartedPush,
  isPushDelivery,
  isPushTarget,
  stillWaitingPush,
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

describe("still waiting to be emptied", () => {
  it("nags with how long it has waited, under the same tag as the done one", () => {
    const push = stillWaitingPush({
      machineName: "Washer",
      sessionId: "s1",
      minutesWaiting: 30,
    });
    expect(push.title).toBe("Washer is still waiting");
    expect(push.body).toBe(
      "Your laundry finished 30 min ago. Empty it so the next person can use it.",
    );
    expect(push.tag).toBe(cycleDonePush({ machineName: "Washer", sessionId: "s1" }).tag);
    expect(
      stillWaitingPush({ machineName: "W", sessionId: "s", minutesWaiting: 75 }).body,
    ).toContain("1h 15m ago");
  });

  it("labels every notification of a cycle alike, and caps the repeats at 12 hours", () => {
    expect(cycleLabel("abc")).toBe("cycle-abc");
    expect(MAX_CHASES).toBe(48);
  });

  it("only accepts a well-formed chase in a delivery", () => {
    const payload = cycleDonePush({ machineName: "Washer", sessionId: "s1" });
    const chase = {
      machineName: "Washer",
      sessionId: "s1",
      finishedAt: 1,
      remaining: 48,
    };
    expect(isPushDelivery({ payload, targets: [target], chase })).toBe(true);
    expect(
      isPushDelivery({ payload, targets: [target], chase: { ...chase, remaining: 999 } }),
    ).toBe(false);
    expect(
      isPushDelivery({
        payload,
        targets: [target],
        chase: { ...chase, sessionId: "a/b" },
      }),
    ).toBe(false);
  });
});

describe("somebody else emptied it", () => {
  const base = {
    ownerName: "Mo Farah",
    emptierName: "Ada Lovelace",
    machineName: "Washer",
    sessionId: "s1",
    at: new Date(Date.UTC(2026, 9, 3, 21, 45)),
    timeZone: "America/Edmonton",
  };

  it("tells the owner who took their laundry out, replacing the reminder", () => {
    const push = emptiedPush({ ...base, to: "owner", stopped: false });
    expect(push.title).toBe("Ada emptied your Washer");
    expect(push.body).toBe("Your laundry was taken out at 3:45 PM.");
    expect(push.tag).toBe("cycle-s1");
  });

  it("warns the owner when it was stopped before it finished", () => {
    const push = emptiedPush({ ...base, to: "owner", stopped: true });
    expect(push.title).toBe("Ada stopped your Washer");
    expect(push.body).toContain("may still be inside");
  });

  it("confirms it to whoever pressed the button", () => {
    const push = emptiedPush({ ...base, to: "emptier", stopped: false });
    expect(push.title).toBe("You emptied Mo's Washer");
    expect(push.body).toBe("Mo has been told.");
  });
});

describe("a booking that has started", () => {
  it("counts down to the release", () => {
    expect(
      bookingStartedPush({ machineName: "Washer", bookingId: "b1", minutesLeft: 10 }),
    ).toEqual({
      title: "Your Washer booking has started",
      body: "Start it within 10 min or the slot is released for others.",
      tag: "booking-b1",
      url: "/",
    });
    expect(bookingLabel("b1")).toBe("booking-b1");
  });

  it("says when it was released, in the house's zone", () => {
    const push = bookingReleasedPush({
      machineName: "Washer",
      bookingId: "b1",
      releasedAt: new Date(Date.UTC(2026, 9, 3, 21, 15)),
      timeZone: "America/Edmonton",
    });
    expect(push.title).toBe("Washer booking released");
    expect(push.body).toContain("did not start it by 3:15 PM");
  });

  it("carries a rendered email only when it is well formed", () => {
    const payload = bookingReleasedPush({
      machineName: "W",
      bookingId: "b",
      releasedAt: new Date(),
    });
    const email = {
      from: "a@b.c",
      to: "d@e.f",
      subject: "s",
      text: "t",
      html: "<p>h</p>",
    };
    expect(isPushDelivery({ payload, targets: [], email })).toBe(true);
    expect(isPushDelivery({ payload, targets: [], email: { ...email, to: "" } })).toBe(
      false,
    );
  });
});
