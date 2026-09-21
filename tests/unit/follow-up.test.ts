import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import { proposeDryerSlot } from "@/lib/follow-up";
import { formatTime } from "@/lib/time";
import type { Booking, Machine } from "@/lib/types";

const dryer = (id: string, minutes = 60): Machine => ({
  id,
  name: id,
  type: "dryer",
  status: "free",
  currentSession: null,
  cycles: [
    { name: "Low", minutes: 40 },
    { name: "Normal", minutes: minutes },
    { name: "Heavy", minutes: 80 },
  ],
});

const at = (hhmm: string): Date => new Date(`2026-09-21T${hhmm}:00.000Z`);

const booking = (machineId: string, from: string, to: string): Booking => ({
  id: `${machineId}-${from}`,
  machineId,
  uid: "someone",
  displayName: "Ada",
  startAt: Timestamp.fromDate(at(from)),
  endAt: Timestamp.fromDate(at(to)),
  createdAt: null,
});

describe("proposeDryerSlot", () => {
  it("offers the slot that starts when the wash ends", () => {
    const proposal = proposeDryerSlot({
      washEndsAt: at("10:00"),
      dryers: [dryer("Dryer")],
      bookings: [],
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.start.toISOString()).toBe(at("10:00").toISOString());
    expect(proposal!.end.toISOString()).toBe(at("11:00").toISOString());
    expect(proposal!.minutes).toBe(60);
    expect(proposal!.delayed).toBe(false);
  });

  it("uses the Normal cycle of that dryer", () => {
    const proposal = proposeDryerSlot({
      washEndsAt: at("10:00"),
      dryers: [dryer("Dryer", 45)],
      bookings: [],
    });
    expect(proposal!.minutes).toBe(45);
    expect(proposal!.end.toISOString()).toBe(at("10:45").toISOString());
  });

  it("rounds a wash that ends off the grid up to the next boundary", () => {
    const proposal = proposeDryerSlot({
      washEndsAt: new Date("2026-09-21T10:07:00.000Z"),
      dryers: [dryer("Dryer")],
      bookings: [],
    });
    expect(proposal!.start.toISOString()).toBe(at("10:15").toISOString());
  });

  it("skips past a booking that is in the way and flags the delay", () => {
    const proposal = proposeDryerSlot({
      washEndsAt: at("10:00"),
      dryers: [dryer("Dryer")],
      bookings: [booking("Dryer", "09:30", "10:30")],
    });
    expect(proposal!.start.toISOString()).toBe(at("10:30").toISOString());
    expect(proposal!.delayed).toBe(true);
  });

  it("walks past several back-to-back bookings", () => {
    const proposal = proposeDryerSlot({
      washEndsAt: at("10:00"),
      dryers: [dryer("Dryer")],
      bookings: [booking("Dryer", "10:00", "11:00"), booking("Dryer", "11:00", "12:00")],
    });
    expect(formatTime(proposal!.start)).toBe(formatTime(at("12:00")));
  });

  it("ignores bookings on other machines", () => {
    const proposal = proposeDryerSlot({
      washEndsAt: at("10:00"),
      dryers: [dryer("Dryer")],
      bookings: [booking("Washer", "10:00", "11:00")],
    });
    expect(proposal!.start.toISOString()).toBe(at("10:00").toISOString());
    expect(proposal!.delayed).toBe(false);
  });

  it("picks whichever dryer is free soonest", () => {
    const proposal = proposeDryerSlot({
      washEndsAt: at("10:00"),
      dryers: [dryer("Dryer 1"), dryer("Dryer 2")],
      bookings: [booking("Dryer 1", "10:00", "12:00")],
    });
    expect(proposal!.machine.id).toBe("Dryer 2");
    expect(proposal!.delayed).toBe(false);
  });

  it("gives up rather than proposing something far away", () => {
    const proposal = proposeDryerSlot({
      washEndsAt: at("10:00"),
      dryers: [dryer("Dryer")],
      bookings: [booking("Dryer", "10:00", "23:30")],
      searchHours: 2,
    });
    expect(proposal).toBeNull();
  });

  it("returns null when the house has no dryer", () => {
    expect(
      proposeDryerSlot({ washEndsAt: at("10:00"), dryers: [], bookings: [] }),
    ).toBeNull();
  });
});
