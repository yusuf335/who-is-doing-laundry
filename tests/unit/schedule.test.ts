import { describe, expect, it } from "vitest";
import {
  dayAccess,
  defaultSchedule,
  emptySchedule,
  groupForDate,
  scheduleNoticeFor,
} from "@/lib/schedule";
import type { House, Member, ScheduleMode } from "@/lib/types";
import { WEEKDAYS } from "@/lib/types";

const groups = ["Upstairs", "Downstairs"];

function house(schedule = defaultSchedule(groups)): House {
  return {
    id: "h1",
    name: "Test house",
    inviteCode: "ABC234",
    adminUid: "admin",
    groups,
    schedule,
    createdAt: null,
  };
}

function member(group: string): Member {
  return {
    uid: "u1",
    displayName: "Sam",
    email: "sam@example.com",
    group,
    role: "member",
    joinedAt: null,
  };
}

// 14 Sep 2026 is a Monday.
const monday = new Date(2026, 8, 14);
const saturday = new Date(2026, 8, 19);
const sunday = new Date(2026, 8, 20);

describe("defaultSchedule", () => {
  it("alternates groups Monday to Saturday and leaves Sunday open", () => {
    const schedule = defaultSchedule(groups);
    expect(schedule.mon).toBe("Upstairs");
    expect(schedule.tue).toBe("Downstairs");
    expect(schedule.wed).toBe("Upstairs");
    expect(schedule.thu).toBe("Downstairs");
    expect(schedule.fri).toBe("Upstairs");
    expect(schedule.sat).toBe("Downstairs");
    expect(schedule.sun).toBeNull();
  });

  it("is all-open with no groups", () => {
    const schedule = defaultSchedule([]);
    for (const day of WEEKDAYS) expect(schedule[day]).toBeNull();
    expect(schedule).toEqual(emptySchedule());
  });

  it("assigns a single group to every day but Sunday", () => {
    const schedule = defaultSchedule(["Everyone"]);
    expect(schedule.mon).toBe("Everyone");
    expect(schedule.sat).toBe("Everyone");
    expect(schedule.sun).toBeNull();
  });
});

describe("groupForDate", () => {
  it("looks the weekday up in the schedule", () => {
    expect(groupForDate(defaultSchedule(groups), monday)).toBe("Upstairs");
    expect(groupForDate(defaultSchedule(groups), sunday)).toBeNull();
  });
});

/** Like scheduleNoticeFor but asserts the banner is shown (i.e. mode is not "open"). */
function noticeOf(...args: Parameters<typeof scheduleNoticeFor>) {
  const notice = scheduleNoticeFor(...args);
  expect(notice).not.toBeNull();
  return notice!;
}

describe("scheduleNoticeFor", () => {
  it("is everyone's day when no group owns it", () => {
    const notice = noticeOf(house(), member("Upstairs"), sunday);
    expect(notice.owner).toBeNull();
    expect(notice.isOwnDay).toBe(true);
    expect(notice.message).toContain("Sunday");
    expect(notice.message).toContain("open to everyone");
  });

  it("is your day when your group owns it", () => {
    const notice = noticeOf(house(), member("Upstairs"), monday);
    expect(notice.owner).toBe("Upstairs");
    expect(notice.isOwnDay).toBe(true);
    expect(notice.message).toContain("Monday is Upstairs day");
    expect(notice.message).toContain("anyone can use it");
  });

  it("is not your day when another group owns it", () => {
    const notice = noticeOf(house(), member("Upstairs"), saturday);
    expect(notice.owner).toBe("Downstairs");
    expect(notice.isOwnDay).toBe(false);
    expect(notice.message).toContain("anyone can use it");
  });

  it("treats a missing member as not owning a group-owned day", () => {
    expect(noticeOf(house(), null, monday).isOwnDay).toBe(false);
  });

  it("treats a missing house as open", () => {
    const notice = noticeOf(null, member("Upstairs"), monday);
    expect(notice.owner).toBeNull();
    expect(notice.isOwnDay).toBe(true);
  });
});

// UTC fixtures so the weekday does not depend on the machine running the tests.
function utcHouse(scheduleMode: ScheduleMode): House {
  return { ...house(), scheduleMode, timeZone: "UTC" };
}
const utcMonday = new Date("2026-09-21T12:00:00Z"); // Upstairs day
const utcTuesday = new Date("2026-09-22T12:00:00Z"); // Downstairs day
const utcSunday = new Date("2026-09-27T12:00:00Z"); // open

describe("dayAccess", () => {
  it("open mode ignores days entirely", () => {
    const access = dayAccess(utcHouse("open"), member("Upstairs"), utcTuesday);
    expect(access).toEqual({
      mode: "open",
      owner: null,
      isOwnDay: true,
      allowed: true,
      reason: null,
    });
  });

  it("soft mode allows the other group's day but says it is not yours", () => {
    const access = dayAccess(utcHouse("soft"), member("Upstairs"), utcTuesday);
    expect(access.mode).toBe("soft");
    expect(access.owner).toBe("Downstairs");
    expect(access.isOwnDay).toBe(false);
    expect(access.allowed).toBe(true);
    expect(access.reason).toBeNull();
  });

  it("strict mode blocks the other group's day with a reason", () => {
    const access = dayAccess(utcHouse("strict"), member("Upstairs"), utcTuesday);
    expect(access.allowed).toBe(false);
    expect(access.isOwnDay).toBe(false);
    expect(access.owner).toBe("Downstairs");
    expect(access.reason).toContain("Tuesday is Downstairs day");
    expect(access.reason).toContain("Only Downstairs");
  });

  it("strict mode allows your own day", () => {
    const access = dayAccess(utcHouse("strict"), member("Upstairs"), utcMonday);
    expect(access.allowed).toBe(true);
    expect(access.isOwnDay).toBe(true);
    expect(access.reason).toBeNull();
  });

  it("strict mode allows a day nobody owns", () => {
    const access = dayAccess(utcHouse("strict"), member("Downstairs"), utcSunday);
    expect(access.owner).toBeNull();
    expect(access.allowed).toBe(true);
  });

  it("strict mode with no member is blocked on an owned day", () => {
    expect(dayAccess(utcHouse("strict"), null, utcMonday).allowed).toBe(false);
  });

  it("no house means no restrictions", () => {
    const access = dayAccess(null, member("Upstairs"), utcTuesday);
    expect(access.allowed).toBe(true);
    expect(access.owner).toBeNull();
  });

  it("defaults a house without a mode to soft", () => {
    expect(dayAccess(house(), member("Upstairs"), saturday).mode).toBe("soft");
  });

  it("uses the house time zone, not the process zone, to pick the day", () => {
    // 03:00 UTC Tuesday is still Monday evening in Los Angeles.
    const la: House = { ...utcHouse("strict"), timeZone: "America/Los_Angeles" };
    const earlyTuesdayUtc = new Date("2026-09-22T03:00:00Z");
    expect(
      dayAccess(utcHouse("strict"), member("Upstairs"), earlyTuesdayUtc).allowed,
    ).toBe(false);
    expect(dayAccess(la, member("Upstairs"), earlyTuesdayUtc).allowed).toBe(true);
  });
});

describe("scheduleNoticeFor by mode", () => {
  it("returns null in open mode so the banner is hidden", () => {
    expect(scheduleNoticeFor(utcHouse("open"), member("Upstairs"), utcMonday)).toBeNull();
  });

  it("strict message says only the owner can start or book", () => {
    const notice = noticeOf(utcHouse("strict"), member("Upstairs"), utcTuesday);
    expect(notice.mode).toBe("strict");
    expect(notice.message).toContain("Only Downstairs");
    expect(notice.isOwnDay).toBe(false);
  });

  it("soft message says anyone can use a free machine", () => {
    const notice = noticeOf(utcHouse("soft"), member("Upstairs"), utcTuesday);
    expect(notice.mode).toBe("soft");
    expect(notice.message).toContain("anyone can use it");
  });

  it("strict open day still reads as open to everyone", () => {
    const notice = noticeOf(utcHouse("strict"), member("Upstairs"), utcSunday);
    expect(notice.owner).toBeNull();
    expect(notice.message).toContain("open to everyone");
  });
});
