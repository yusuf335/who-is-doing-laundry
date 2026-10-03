import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import { isNoShow, machineState, type Machine } from "@/lib/types";

const now = Date.UTC(2026, 8, 19, 12, 0, 0);

function machine(overrides: Partial<Machine>): Machine {
  return {
    id: "m1",
    name: "Washer",
    type: "washer",
    status: "free",
    currentSession: null,
    ...overrides,
  };
}

function session(expectedEndMs: number) {
  return {
    sessionId: "s1",
    uid: "u1",
    displayName: "Sam",
    startedAt: Timestamp.fromMillis(now - 30 * 60_000),
    expectedEndAt: Timestamp.fromMillis(expectedEndMs),
  };
}

describe("machineState", () => {
  it("is free when the status is free", () => {
    expect(machineState(machine({ status: "free" }), now)).toBe("free");
  });

  it("is free when in_use but the session is missing", () => {
    expect(machineState(machine({ status: "in_use", currentSession: null }), now)).toBe(
      "free",
    );
  });

  it("is running while the expected end is in the future", () => {
    const m = machine({ status: "in_use", currentSession: session(now + 60_000) });
    expect(machineState(m, now)).toBe("running");
  });

  it("is finished once the expected end has passed", () => {
    const m = machine({ status: "in_use", currentSession: session(now - 1) });
    expect(machineState(m, now)).toBe("finished");
  });

  it("is finished exactly at the expected end", () => {
    const m = machine({ status: "in_use", currentSession: session(now) });
    expect(machineState(m, now)).toBe("finished");
  });
});

describe("isNoShow", () => {
  const minute = 60_000;
  const at = (offsetMin: number) =>
    Timestamp.fromMillis(1_000_000_000_000 + offsetMin * minute);
  const now = 1_000_000_000_000;
  const booking = (startMin: number, endMin: number, checkedIn = false) => ({
    startAt: at(startMin),
    endAt: at(endMin),
    ...(checkedIn ? { checkedInAt: at(startMin) } : {}),
  });

  it("releases a booking 15 minutes after its start when nobody started it", () => {
    expect(isNoShow(booking(-15, 45), now)).toBe(true);
    expect(isNoShow(booking(-14, 45), now)).toBe(false);
  });

  it("never releases one that was checked in, or that is already over", () => {
    expect(isNoShow(booking(-30, 30, true), now)).toBe(false);
    expect(isNoShow(booking(-90, -30), now)).toBe(false);
  });
});
