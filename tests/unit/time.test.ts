import { describe, expect, it } from "vitest";
import {
  addDays,
  atTime,
  formatDayAndTime,
  formatDuration,
  formatMinutes,
  formatSlotLabel,
  isValidTimeZone,
  slotId,
  slotIdsForRange,
  slotTimeOptions,
  snapToSlot,
  SLOT_MINUTES,
  weekdayOf,
} from "@/lib/time";

const day = new Date(2026, 8, 19); // 19 Sep 2026, local midnight

describe("snapToSlot", () => {
  it("rounds down to the previous 15-minute boundary", () => {
    const d = new Date(2026, 8, 19, 10, 44, 59, 999);
    const snapped = snapToSlot(d);
    expect(snapped.getHours()).toBe(10);
    expect(snapped.getMinutes()).toBe(30);
    expect(snapped.getSeconds()).toBe(0);
    expect(snapped.getMilliseconds()).toBe(0);
  });

  it("leaves an already-aligned time untouched", () => {
    const d = new Date(2026, 8, 19, 10, 45, 0, 0);
    expect(snapToSlot(d).getTime()).toBe(d.getTime());
  });

  it("does not mutate its input", () => {
    const d = new Date(2026, 8, 19, 10, 44);
    const before = d.getTime();
    snapToSlot(d);
    expect(d.getTime()).toBe(before);
  });
});

describe("atTime", () => {
  it("places an HH:mm on the given day", () => {
    const d = atTime(new Date(2026, 8, 19, 17, 3), "09:15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(19);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(15);
    expect(d.getSeconds()).toBe(0);
  });
});

describe("slotTimeOptions", () => {
  it("covers the day on a 15-minute grid", () => {
    const options = slotTimeOptions();
    expect(options).toHaveLength(96);
    expect(options[0]).toBe("00:00");
    expect(options[options.length - 1]).toBe("23:45");
    expect(options).toContain("12:30");
    expect(new Set(options).size).toBe(96);
  });
});

describe("slotIdsForRange", () => {
  const start = atTime(day, "10:00");
  const end = atTime(day, "11:00");

  it("gives four ids for an hour, end exclusive", () => {
    const ids = slotIdsForRange("washer", start, end);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe(slotId("washer", start));
    expect(ids).not.toContain(slotId("washer", end));
  });

  it("gives no ids for an empty range", () => {
    expect(slotIdsForRange("washer", start, start)).toEqual([]);
  });

  it("does not overlap for adjacent bookings on the same machine", () => {
    const first = slotIdsForRange("washer", start, end);
    const second = slotIdsForRange("washer", end, atTime(day, "12:00"));
    expect(first.some((id) => second.includes(id))).toBe(false);
  });

  it("does overlap for bookings that share a slot", () => {
    const first = slotIdsForRange("washer", start, end);
    const second = slotIdsForRange("washer", atTime(day, "10:45"), atTime(day, "11:30"));
    expect(first.filter((id) => second.includes(id))).toHaveLength(1);
  });

  it("differs between machines for the same time", () => {
    expect(slotId("washer", start)).not.toBe(slotId("dryer", start));
    expect(slotId("washer", start)).toMatch(/^washer_\d+$/);
  });

  it("is identical however the Date for the same instant was constructed", () => {
    const fromParts = atTime(day, "10:00");
    const fromMillis = new Date(fromParts.getTime());
    const fromIso = new Date(fromParts.toISOString());
    expect(slotIdsForRange("washer", fromMillis, end)).toEqual(
      slotIdsForRange("washer", fromParts, end),
    );
    expect(slotIdsForRange("washer", fromIso, end)).toEqual(
      slotIdsForRange("washer", fromParts, end),
    );
  });

  it("advances one id per slot", () => {
    const ids = slotIdsForRange("washer", start, end);
    const indices = ids.map((id) => Number(id.split("_")[1]));
    for (let i = 1; i < indices.length; i++) expect(indices[i] - indices[i - 1]).toBe(1);
    expect(SLOT_MINUTES).toBe(15);
  });
});

describe("formatDuration", () => {
  it("formats hours, minutes and seconds", () => {
    expect(formatDuration(65 * 60_000)).toBe("1h 05m");
    expect(formatDuration(12 * 60_000 + 7_000)).toBe("12m 07s");
    expect(formatDuration(40_000)).toBe("40s");
  });

  it("never goes negative", () => {
    expect(formatDuration(-5_000)).toBe("0s");
  });
});

describe("formatMinutes", () => {
  it("uses minutes below an hour and h/m above", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(90)).toBe("1h 30m");
  });
});

describe("formatDayAndTime", () => {
  const today = new Date(2026, 8, 19, 15, 0);

  it("labels today and tomorrow", () => {
    expect(formatDayAndTime(atTime(today, "18:30"), today)).toBe("today 6:30 PM");
    expect(formatDayAndTime(atTime(addDays(today, 1), "08:00"), today)).toBe(
      "tomorrow 8:00 AM",
    );
  });

  it("uses a weekday/date for other days", () => {
    // 21 Sep 2026 is a Monday
    expect(formatDayAndTime(atTime(addDays(today, 2), "09:15"), today)).toBe(
      "Mon 21 Sep 9:15 AM",
    );
  });
});

describe("formatSlotLabel", () => {
  it("turns a 24-hour grid value into a 12-hour label", () => {
    expect(formatSlotLabel("15:30")).toBe("3:30 PM");
    expect(formatSlotLabel("00:00")).toBe("12:00 AM");
    expect(formatSlotLabel("12:15")).toBe("12:15 PM");
  });
});

describe("weekdayOf with a time zone", () => {
  // 2026-09-21T03:00Z is Monday in UTC but Sunday 20:00 PDT in Los Angeles.
  const instant = new Date("2026-09-21T03:00:00Z");

  it("answers for the given zone", () => {
    expect(weekdayOf(instant, "UTC")).toBe("mon");
    expect(weekdayOf(instant, "America/Los_Angeles")).toBe("sun");
    expect(weekdayOf(instant, "Asia/Tokyo")).toBe("mon");
  });

  it("falls back to the process-local weekday for an unknown zone", () => {
    expect(() => weekdayOf(instant, "Mars/Olympus")).not.toThrow();
    expect(weekdayOf(instant, "Mars/Olympus")).toBe(weekdayOf(instant));
  });

  it("matches the local answer when no zone is given", () => {
    const local = new Date(2026, 8, 21, 12);
    expect(weekdayOf(local)).toBe("mon");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects nonsense", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
