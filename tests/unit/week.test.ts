import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import type { Booking, Machine } from "@/lib/types";
import {
  blocksForDay,
  firstOverlap,
  freeGaps,
  nextBookingAfter,
  nextFreeSlot,
  sessionBlocks,
  validStarts,
  visibleDays,
} from "@/lib/week";

const day = new Date(2026, 9, 3); // Sat 3 Oct 2026, local midnight
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);

let seq = 0;
const booking = (machineId: string, from: Date, to: Date, uid = "u1"): Booking => ({
  id: `b${seq++}`,
  machineId,
  uid,
  displayName: uid,
  startAt: Timestamp.fromDate(from),
  endAt: Timestamp.fromDate(to),
  createdAt: null,
});

describe("visibleDays", () => {
  it("returns consecutive midnights from the given day", () => {
    const days = visibleDays(at(3, 15, 20), 3);
    expect(days.map((d) => [d.getDate(), d.getHours(), d.getMinutes()])).toEqual([
      [3, 0, 0],
      [4, 0, 0],
      [5, 0, 0],
    ]);
  });
});

describe("blocksForDay", () => {
  it("keeps only that machine's bookings on that day, in order", () => {
    const blocks = blocksForDay(
      [
        booking("w", at(3, 16), at(3, 17)),
        booking("w", at(3, 9), at(3, 10)),
        booking("d", at(3, 12), at(3, 13)),
        booking("w", at(4, 9), at(4, 10)),
      ],
      "w",
      day,
    );
    expect(blocks.map((b) => [b.startMinute, b.endMinute])).toEqual([
      [540, 600],
      [960, 1020],
    ]);
  });

  it("splits a booking that runs past midnight across both days", () => {
    const late = [booking("w", at(3, 23), at(4, 1))];
    expect(blocksForDay(late, "w", day)[0]).toMatchObject({
      startMinute: 1380,
      endMinute: 1440,
      continued: false,
    });
    expect(blocksForDay(late, "w", at(4, 0))[0]).toMatchObject({
      startMinute: 0,
      endMinute: 60,
      continued: true,
    });
  });
});

describe("freeGaps", () => {
  const bookings = [
    booking("w", at(3, 9), at(3, 10)),
    booking("w", at(3, 16), at(3, 17)),
  ];

  it("lists the open stretches between bookings across a future day", () => {
    const gaps = freeGaps(bookings, "w", day, at(2, 12).getTime());
    expect(gaps).toEqual([
      { startMinute: 0, endMinute: 540 },
      { startMinute: 600, endMinute: 960 },
      { startMinute: 1020, endMinute: 1440 },
    ]);
  });

  it("starts today's first gap at the next quarter hour, not in the past", () => {
    const gaps = freeGaps(bookings, "w", day, at(3, 13, 40).getTime());
    expect(gaps[0]).toEqual({ startMinute: 825, endMinute: 960 });
  });

  it("drops gaps shorter than asked for", () => {
    const tight = [
      booking("w", at(3, 9), at(3, 10)),
      booking("w", at(3, 10, 30), at(3, 23)),
    ];
    const gaps = freeGaps(tight, "w", day, at(2, 0).getTime(), 45);
    expect(gaps).toEqual([
      { startMinute: 0, endMinute: 540 },
      { startMinute: 1380, endMinute: 1440 },
    ]);
  });

  it("returns nothing for a day that is already over", () => {
    expect(freeGaps([], "w", day, at(4, 0, 30).getTime())).toEqual([]);
  });

  it("ignores other machines", () => {
    const gaps = freeGaps(
      [booking("d", at(3, 0), at(3, 23))],
      "w",
      day,
      at(2, 0).getTime(),
    );
    expect(gaps).toEqual([{ startMinute: 0, endMinute: 1440 }]);
  });
});

describe("nextFreeSlot", () => {
  it("finds the first gap long enough, today first", () => {
    const bookings = [booking("w", at(3, 14), at(3, 23, 45))];
    const slot = nextFreeSlot(bookings, "w", at(3, 13, 40).getTime(), 45);
    // 13:45 to 14:00 is too short; today's last 15 minutes too; so tomorrow midnight.
    expect(slot).toEqual(at(4, 0));
  });

  it("skips days the member may not use", () => {
    const slot = nextFreeSlot(
      [],
      "w",
      at(3, 10).getTime(),
      30,
      7,
      (d) => d.getDate() !== 3,
    );
    expect(slot).toEqual(at(4, 0));
  });

  it("gives up after the window", () => {
    expect(nextFreeSlot([], "w", at(3, 10).getTime(), 30, 2, () => false)).toBeNull();
  });
});

describe("firstOverlap and nextBookingAfter", () => {
  const bookings = [
    booking("w", at(3, 16), at(3, 17)),
    booking("w", at(3, 19), at(3, 20)),
  ];

  it("treats touching ends as free", () => {
    expect(firstOverlap(bookings, "w", at(3, 15), at(3, 16))).toBeNull();
    expect(firstOverlap(bookings, "w", at(3, 15), at(3, 16, 15))?.id).toBe(
      bookings[0].id,
    );
  });

  it("finds the next booking from a moment", () => {
    expect(nextBookingAfter(bookings, "w", at(3, 17))?.id).toBe(bookings[1].id);
    expect(nextBookingAfter(bookings, "w", at(3, 20))).toBeNull();
  });
});

describe("sessionBlocks", () => {
  const machine = (status: "free" | "in_use", end?: Date): Machine => ({
    id: "w",
    name: "Washer",
    type: "washer",
    status,
    currentSession: end
      ? {
          sessionId: "s1",
          uid: "u2",
          displayName: "Sam",
          startedAt: Timestamp.fromDate(at(3, 13)),
          expectedEndAt: Timestamp.fromDate(end),
        }
      : null,
  });

  it("turns a running cycle into taken time, so it is never offered as free", () => {
    const now = at(3, 13, 40).getTime();
    const blocks = sessionBlocks([machine("in_use", at(3, 14))], now);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ machineId: "w", inUse: true, displayName: "Sam" });
    expect(freeGaps(blocks, "w", day, now)[0]).toEqual({
      startMinute: 840,
      endMinute: 1440,
    });
  });

  it("holds a finished but unemptied machine until the next quarter hour", () => {
    const now = at(3, 14, 20).getTime();
    const [block] = sessionBlocks([machine("in_use", at(3, 14))], now);
    expect(block.endAt.toDate()).toEqual(at(3, 14, 30));
  });

  it("ignores free machines", () => {
    expect(sessionBlocks([machine("free")], at(3, 12).getTime())).toEqual([]);
  });
});

describe("edges of the day", () => {
  it("blocks the morning of a booking carried over from last night", () => {
    const carried = [booking("w", at(2, 23), at(3, 1))];
    expect(freeGaps(carried, "w", day, at(3, 0, 10).getTime())[0].startMinute).toBe(60);
  });

  it("offers nothing at 23:50, when no full slot is left", () => {
    expect(freeGaps([], "w", day, at(3, 23, 50).getTime())).toEqual([]);
  });
});

describe("validStarts", () => {
  const bookings = [booking("w", at(3, 16), at(3, 17))];
  const times = (dates: Date[]) =>
    dates.map((d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);

  it("offers only future starts where the whole cycle fits before the next booking", () => {
    const starts = times(validStarts(bookings, "w", day, at(3, 14, 40).getTime(), 60));
    expect(starts.slice(0, 3)).toEqual(["14:45", "15:00", "17:00"]);
    expect(starts).not.toContain("15:15");
    expect(starts).not.toContain("16:30");
  });

  it("lets a booking end exactly when the next one starts", () => {
    const starts = times(validStarts(bookings, "w", day, at(3, 0).getTime(), 45));
    expect(starts).toContain("15:15");
    expect(starts).not.toContain("15:30");
  });

  it("allows a late start that runs past midnight", () => {
    const starts = times(validStarts([], "w", day, at(3, 0).getTime(), 60));
    expect(starts[starts.length - 1]).toBe("23:45");
  });

  it("is empty when the day is over", () => {
    expect(validStarts([], "w", day, at(4, 0, 5).getTime(), 30)).toEqual([]);
  });
});

describe("two-week booking horizon", () => {
  const now = at(3, 10).getTime(); // Sat 3 Oct, 10:00

  it("keeps the whole of the 14th day ahead open", () => {
    // From Sat 3 Oct, the last open day is Sat 17 Oct, all of it.
    expect(freeGaps([], "w", at(17, 0), now)).toEqual([
      { startMinute: 0, endMinute: 1440 },
    ]);
    const starts = validStarts([], "w", at(17, 0), now, 30);
    expect(starts[starts.length - 1]).toEqual(at(17, 23, 45));
  });

  it("offers nothing from the 15th day on", () => {
    expect(freeGaps([], "w", at(18, 0), now)).toEqual([]);
    expect(validStarts([], "w", at(18, 0), now, 30)).toEqual([]);
  });
});
