import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LaundryError } from "@/lib/errors";
import type { ServerContext } from "@/lib/firebase-server";
import {
  addMachine,
  cancelBooking,
  clearHousePointer,
  createBooking,
  createHouse,
  decideJoinRequest,
  endSession,
  joinHouse,
  leaveHouse,
  lookupInviteCode,
  notifyCycleFinished,
  pruneOldRecords,
  registerDevice,
  regenerateInviteCode,
  removeMachine,
  reorderMachines,
  removeMember,
  renameMachine,
  setJoinApproval,
  startSession,
  unregisterDevice,
  updateHouseDetails,
  updateMachineCycles,
  updateMemberGroup,
  updateSchedule,
  updateScheduleSettings,
} from "@/server/laundry";
import {
  MAX_BOOKING_MINUTES,
  SLOT_MINUTES,
  addDays,
  atTime,
  formatTime,
  slotIdsForRange,
  snapToSlot,
  weekdayOf,
} from "@/lib/time";
import type {
  House,
  Machine,
  Member,
  Schedule,
  ScheduleMode,
  Weekday,
} from "@/lib/types";
import { DEFAULT_CYCLES, DEFAULT_MAX_MINUTES, WEEKDAYS } from "@/lib/types";

// Every context is a rules-enforced Firestore signed in as that uid, so each test proves
// both that the logic does the right thing and that firestore.rules lets it.

const ADMIN = "admin-uid";
const MEMBER = "member-uid";
const OTHER = "other-uid";
const STRANGER = "stranger-uid";
const GROUPS = ["Upstairs", "Downstairs"];
const SLOT_MS = SLOT_MINUTES * 60_000;

let testEnv: RulesTestEnvironment;

function ctxFor(uid: string, displayName = uid): ServerContext {
  return {
    db: testEnv
      .authenticatedContext(uid, { email: `${uid}@example.com` })
      .firestore() as unknown as Firestore,
    user: { uid, email: `${uid}@example.com`, displayName },
  };
}

/** Rules-disabled Firestore for seeding and for inspecting what really got written. */
async function raw<T>(work: (db: Firestore) => Promise<T>): Promise<T> {
  let result!: T;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    result = await work(ctx.firestore() as unknown as Firestore);
  });
  return result;
}

const admin = () => ctxFor(ADMIN, "Ada");
const member = () => ctxFor(MEMBER, "Mo");
const other = () => ctxFor(OTHER, "Olu");
const stranger = () => ctxFor(STRANGER, "Sky");

interface Fixture {
  houseId: string;
  code: string;
  washerId: string;
  dryerId: string;
}

/** A house made through the real onboarding path: admin creates, two members join. */
async function setupHouse(): Promise<Fixture> {
  const { houseId } = await createHouse(admin(), {
    houseName: "Test house",
    displayName: "Ada",
    groups: GROUPS,
    group: "Upstairs",
  });
  const house = await raw(
    async (db) => (await getDoc(doc(db, "houses", houseId))).data() as House,
  );
  await joinHouse(member(), {
    code: house.inviteCode,
    displayName: "Mo",
    group: "Upstairs",
  });
  await joinHouse(other(), {
    code: house.inviteCode,
    displayName: "Olu",
    group: "Downstairs",
  });

  const machines = await raw(
    async (db) => (await getDocs(collection(db, "houses", houseId, "machines"))).docs,
  );
  const washerId = machines.find((m) => m.data().type === "washer")!.id;
  const dryerId = machines.find((m) => m.data().type === "dryer")!.id;
  return { houseId, code: house.inviteCode, washerId, dryerId };
}

const readMachine = (houseId: string, machineId: string) =>
  raw(
    async (db) =>
      (await getDoc(doc(db, "houses", houseId, "machines", machineId))).data() as
        Machine | undefined,
  );

const readHouse = (houseId: string) =>
  raw(async (db) => (await getDoc(doc(db, "houses", houseId))).data() as House);

const readMember = (houseId: string, uid: string) =>
  raw(async (db) => {
    const snap = await getDoc(doc(db, "houses", houseId, "members", uid));
    return snap.exists() ? (snap.data() as Member) : undefined;
  });

const readPointer = (uid: string) =>
  raw(
    async (db) =>
      (await getDoc(doc(db, "users", uid))).data() as
        { houseId: string | null } | undefined,
  );

const listSlots = (houseId: string) =>
  raw(async (db) => (await getDocs(collection(db, "houses", houseId, "slots"))).docs);

const listBookings = (houseId: string) =>
  raw(async (db) => (await getDocs(collection(db, "houses", houseId, "bookings"))).docs);

const listSessions = (houseId: string) =>
  raw(async (db) => (await getDocs(collection(db, "houses", houseId, "sessions"))).docs);

/** Mirrors deviceIdFor() in the server module, which is private on purpose. */
const deviceId = (token: string) =>
  Buffer.from(token).toString("base64url").slice(0, 1400);

const listDevices = (houseId: string) =>
  raw(async (db) => (await getDocs(collection(db, "houses", houseId, "devices"))).docs);

const readDevice = (houseId: string, token: string) =>
  raw(async (db) => {
    const snap = await getDoc(doc(db, "houses", houseId, "devices", deviceId(token)));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
  });

const readSession = (houseId: string, sessionId: string) =>
  raw(async (db) => {
    const snap = await getDoc(doc(db, "houses", houseId, "sessions", sessionId));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
  });

const readJoinRequest = (houseId: string, uid: string) =>
  raw(async (db) => {
    const snap = await getDoc(doc(db, "houses", houseId, "joinRequests", uid));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
  });

const listJoinRequests = (houseId: string) =>
  raw(
    async (db) => (await getDocs(collection(db, "houses", houseId, "joinRequests"))).docs,
  );

/** The next 15-minute boundary at least `hoursAhead` hours from now, always bookable. */
function futureSlot(hoursAhead: number): number {
  return Math.ceil(Date.now() / SLOT_MS) * SLOT_MS + hoursAhead * 3_600_000;
}

/** Tomorrow at HH:mm, as epoch ms (local time; lands on the slot grid). */
function tomorrowAt(hhmm: string): number {
  return atTime(addDays(new Date(), 1), hhmm).getTime();
}

async function expectLaundryError(promise: Promise<unknown>, fragment: string) {
  await expect(promise).rejects.toBeInstanceOf(LaundryError);
  await expect(promise).rejects.toThrow(fragment);
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-laundry",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

/* ------------------------------------------------------------------ onboarding */

describe("createHouse", () => {
  it("creates the house, invite code, admin member, pointer and two machines", async () => {
    const { houseId } = await createHouse(admin(), {
      houseName: "  12 Oak Street ",
      displayName: " Ada ",
      groups: GROUPS,
      group: "Upstairs",
    });
    expect(houseId).toBeTruthy();

    const house = await readHouse(houseId);
    expect(house.name).toBe("12 Oak Street");
    expect(house.adminUid).toBe(ADMIN);
    expect(house.groups).toEqual(GROUPS);
    expect(house.schedule.mon).toBe("Upstairs");
    expect(house.schedule.sun).toBeNull();
    expect(house.inviteCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(house.scheduleMode).toBe("soft");
    expect(house.timeZone).toBe("UTC"); // none given

    const invite = await raw(async (db) =>
      (await getDoc(doc(db, "inviteCodes", house.inviteCode))).data(),
    );
    expect(invite).toEqual({
      houseId,
      houseName: "12 Oak Street",
      groups: GROUPS,
      requireApproval: false,
    });

    const me = await readMember(houseId, ADMIN);
    expect(me).toMatchObject({
      displayName: "Ada",
      role: "admin",
      group: "Upstairs",
      email: `${ADMIN}@example.com`,
    });

    expect(await readPointer(ADMIN)).toMatchObject({ houseId, displayName: "Ada" });

    const machines = await raw(async (db) =>
      (await getDocs(collection(db, "houses", houseId, "machines"))).docs.map((d) =>
        d.data(),
      ),
    );
    expect(machines.map((m) => m.name).sort()).toEqual(["Dryer", "Washer"]);
    expect(machines.every((m) => m.status === "free" && m.currentSession === null)).toBe(
      true,
    );

    // Each default machine starts with named cycles, a custom limit and a position.
    const washer = machines.find((m) => m.name === "Washer")!;
    const dryer = machines.find((m) => m.name === "Dryer")!;
    expect(washer).toMatchObject({
      cycles: DEFAULT_CYCLES.washer,
      maxMinutes: DEFAULT_MAX_MINUTES.washer,
      order: 0,
    });
    expect(dryer).toMatchObject({
      cycles: DEFAULT_CYCLES.dryer,
      maxMinutes: DEFAULT_MAX_MINUTES.dryer,
      order: 1,
    });
  });

  it("rejects bad input", async () => {
    const base = {
      houseName: "House",
      displayName: "Ada",
      groups: GROUPS,
      group: "Upstairs",
    };
    await expectLaundryError(
      createHouse(admin(), { ...base, houseName: "  " }),
      "Give the house a name",
    );
    await expectLaundryError(
      createHouse(admin(), { ...base, displayName: "" }),
      "your name",
    );
    await expectLaundryError(
      createHouse(admin(), { ...base, group: "Attic" }),
      "Pick the group",
    );
    await expectLaundryError(
      createHouse(admin(), { ...base, groups: ["A", "A"] }),
      "unique",
    );
    await expectLaundryError(
      createHouse(admin(), { ...base, groups: [" ", ""] }),
      "at least one group",
    );
    expect(await raw(async (db) => (await getDocs(collection(db, "houses"))).size)).toBe(
      0,
    );
  });

  it("retries with a new code when the random code is already taken", async () => {
    // Pre-seed an inviteCodes doc for every code generateInviteCode could return? Not
    // feasible; instead prove the path by seeding a house whose code we then steal.
    const first = await createHouse(admin(), {
      houseName: "One",
      displayName: "Ada",
      groups: GROUPS,
      group: "Upstairs",
    });
    const firstHouse = await readHouse(first.houseId);
    // A second creator cannot overwrite the existing code doc (rules) and must not
    // clobber the first house's invite mapping.
    const second = await createHouse(stranger(), {
      houseName: "Two",
      displayName: "Sky",
      groups: GROUPS,
      group: "Upstairs",
    });
    const secondHouse = await readHouse(second.houseId);
    expect(secondHouse.inviteCode).not.toBe(firstHouse.inviteCode);
    const firstInvite = await raw(async (db) =>
      (await getDoc(doc(db, "inviteCodes", firstHouse.inviteCode))).data(),
    );
    expect(firstInvite?.houseId).toBe(first.houseId);
  });
});

describe("createHouse time zone", () => {
  it("stores a valid zone from the creator's device", async () => {
    const { houseId } = await createHouse(admin(), {
      houseName: "Zoned",
      displayName: "Ada",
      groups: GROUPS,
      group: "Upstairs",
      timeZone: "Europe/Berlin",
    });
    expect((await readHouse(houseId)).timeZone).toBe("Europe/Berlin");
  });

  it("falls back to UTC for an unknown zone", async () => {
    const { houseId } = await createHouse(admin(), {
      houseName: "Zoned",
      displayName: "Ada",
      groups: GROUPS,
      group: "Upstairs",
      timeZone: "Mars/Olympus",
    });
    expect((await readHouse(houseId)).timeZone).toBe("UTC");
  });
});

describe("lookupInviteCode", () => {
  it("normalises case and whitespace", async () => {
    const { houseId, code } = await setupHouse();
    const found = await lookupInviteCode(stranger(), `  ${code.toLowerCase()} `);
    expect(found).toEqual({
      code,
      houseId,
      houseName: "Test house",
      groups: GROUPS,
      requireApproval: false,
    });
  });

  it("fails for an unknown or too-short code", async () => {
    await setupHouse();
    await expectLaundryError(lookupInviteCode(stranger(), "ZZZZZZ"), "No house found");
    await expectLaundryError(lookupInviteCode(stranger(), "ab"), "too short");
  });
});

describe("joinHouse", () => {
  it("adds a member and sets their pointer", async () => {
    const { houseId, code } = await setupHouse();
    const result = await joinHouse(stranger(), {
      code,
      displayName: " Sky ",
      group: "Downstairs",
    });
    expect(result).toEqual({
      houseId,
      houseName: "Test house",
      rejoined: false,
      pending: false,
    });
    expect(await readMember(houseId, STRANGER)).toMatchObject({
      displayName: "Sky",
      group: "Downstairs",
      role: "member",
    });
    expect(await readPointer(STRANGER)).toMatchObject({ houseId, displayName: "Sky" });
  });

  it("fails with a bad group, empty name or when already in a house", async () => {
    const { houseId, code } = await setupHouse();
    await expectLaundryError(
      joinHouse(stranger(), { code, displayName: "Sky", group: "Attic" }),
      "Pick the group",
    );
    await expectLaundryError(
      joinHouse(stranger(), { code, displayName: " ", group: "Upstairs" }),
      "your name",
    );
    await expectLaundryError(
      joinHouse(member(), { code, displayName: "Mo", group: "Upstairs" }),
      "already in a house",
    );
    expect(await readMember(houseId, STRANGER)).toBeUndefined();
  });
});

describe("join approval", () => {
  /** A house that vets newcomers, plus the code a stranger would use. */
  async function vettedHouse() {
    const fixture = await setupHouse();
    await setJoinApproval(admin(), { houseId: fixture.houseId, required: true });
    return fixture;
  }

  it("turns the invite code into a request instead of a membership", async () => {
    const { houseId, code } = await vettedHouse();

    const result = await joinHouse(stranger(), {
      code,
      displayName: " Sky ",
      group: "Downstairs",
    });
    expect(result).toEqual({
      houseId,
      houseName: "Test house",
      rejoined: false,
      pending: true,
    });

    expect(await readJoinRequest(houseId, STRANGER)).toMatchObject({
      uid: STRANGER,
      displayName: "Sky",
      group: "Downstairs",
      status: "pending",
      decidedAt: null,
    });
    expect((await readJoinRequest(houseId, STRANGER))!.requestedAt).toBeDefined();

    // Nothing that would let them in yet.
    expect(await readMember(houseId, STRANGER)).toBeUndefined();
    expect(await readPointer(STRANGER)).toBeUndefined();
  });

  it("keeps the original request time when somebody checks back", async () => {
    const { houseId, code } = await vettedHouse();
    await joinHouse(stranger(), { code, displayName: "Sky", group: "Downstairs" });
    const first = await readJoinRequest(houseId, STRANGER);

    const again = await joinHouse(stranger(), {
      code,
      displayName: "Sky",
      group: "Downstairs",
    });
    expect(again.pending).toBe(true);

    const second = await readJoinRequest(houseId, STRANGER);
    expect(second!.requestedAt).toEqual(first!.requestedAt);
    expect(second!.status).toBe("pending");
    expect((await listJoinRequests(houseId)).length).toBe(1);
  });

  it("lets the approved applicant finish joining, and clears the request", async () => {
    const { houseId, code } = await vettedHouse();
    await joinHouse(stranger(), { code, displayName: "Sky", group: "Downstairs" });

    await decideJoinRequest(admin(), { houseId, uid: STRANGER, approve: true });
    const decided = await readJoinRequest(houseId, STRANGER);
    expect(decided!.status).toBe("approved");
    expect(decided!.decidedAt).not.toBeNull();

    const result = await joinHouse(stranger(), {
      code,
      displayName: "Sky",
      group: "Downstairs",
    });
    expect(result.pending).toBe(false);
    expect(result.rejoined).toBe(false);

    expect(await readMember(houseId, STRANGER)).toMatchObject({
      displayName: "Sky",
      group: "Downstairs",
      role: "member",
    });
    expect(await readPointer(STRANGER)).toMatchObject({ houseId });
    expect(await readJoinRequest(houseId, STRANGER)).toBeUndefined();
  });

  it("turns a declined applicant away and leaves them out", async () => {
    const { houseId, code } = await vettedHouse();
    await joinHouse(stranger(), { code, displayName: "Sky", group: "Downstairs" });

    await decideJoinRequest(admin(), { houseId, uid: STRANGER, approve: false });
    expect((await readJoinRequest(houseId, STRANGER))!.status).toBe("declined");

    await expectLaundryError(
      joinHouse(stranger(), { code, displayName: "Sky", group: "Downstairs" }),
      "turned down",
    );
    expect(await readMember(houseId, STRANGER)).toBeUndefined();
    expect(await readPointer(STRANGER)).toBeUndefined();
  });

  it("only lets the admin decide", async () => {
    const { houseId, code } = await vettedHouse();
    await joinHouse(stranger(), { code, displayName: "Sky", group: "Downstairs" });

    await expectLaundryError(
      decideJoinRequest(member(), { houseId, uid: STRANGER, approve: true }),
      "Only the house admin",
    );
    await expectLaundryError(
      decideJoinRequest(stranger(), { houseId, uid: STRANGER, approve: true }),
      "not a member",
    );
    expect((await readJoinRequest(houseId, STRANGER))!.status).toBe("pending");

    await expectLaundryError(
      decideJoinRequest(admin(), { houseId, uid: "nobody-uid", approve: true }),
      "no longer there",
    );
  });

  it("only lets the admin change the setting, and only to a boolean", async () => {
    const { houseId } = await setupHouse();
    await expectLaundryError(
      setJoinApproval(member(), { houseId, required: true }),
      "Only the house admin",
    );
    await expectLaundryError(
      setJoinApproval(stranger(), { houseId, required: true }),
      "not a member",
    );
    await expectLaundryError(
      setJoinApproval(admin(), {
        houseId,
        required: "yes" as unknown as boolean,
      }),
      "on or off",
    );
    expect((await readHouse(houseId)).requireApproval).toBe(false);

    await setJoinApproval(admin(), { houseId, required: true });
    expect((await readHouse(houseId)).requireApproval).toBe(true);
  });

  it("keeps the house and the invite document in step", async () => {
    const { houseId, code } = await setupHouse();
    const readInvite = (inviteCode: string) =>
      raw(
        async (db) =>
          (await getDoc(doc(db, "inviteCodes", inviteCode))).data() as
            Record<string, unknown> | undefined,
      );

    // A newcomer can only read the invite document, so the two copies must agree or the
    // gate silently stops working for exactly the people it is meant to stop.
    expect((await readHouse(houseId)).requireApproval).toBe(false);
    expect((await readInvite(code))!.requireApproval).toBe(false);

    await setJoinApproval(admin(), { houseId, required: true });
    expect((await readHouse(houseId)).requireApproval).toBe(true);
    expect((await readInvite(code))!.requireApproval).toBe(true);

    // A fresh code has to carry the current setting, not the default.
    const { code: newCode } = await regenerateInviteCode(admin(), { houseId });
    expect(newCode).not.toBe(code);
    expect((await readInvite(newCode))!.requireApproval).toBe(true);
    expect(await readInvite(code)).toBeUndefined();

    // And back again.
    await setJoinApproval(admin(), { houseId, required: false });
    expect((await readHouse(houseId)).requireApproval).toBe(false);
    expect((await readInvite(newCode))!.requireApproval).toBe(false);
  });

  it("lets a waiting applicant straight in once approval is switched off", async () => {
    const { houseId, code } = await vettedHouse();
    await joinHouse(stranger(), { code, displayName: "Sky", group: "Downstairs" });
    expect(await readMember(houseId, STRANGER)).toBeUndefined();

    await setJoinApproval(admin(), { houseId, required: false });
    const result = await joinHouse(stranger(), {
      code,
      displayName: "Sky",
      group: "Downstairs",
    });

    expect(result.pending).toBe(false);
    expect(await readMember(houseId, STRANGER)).toMatchObject({ role: "member" });
    expect(await readPointer(STRANGER)).toMatchObject({ houseId });
  });
});

describe("leaveHouse", () => {
  it("takes the membership, the bookings, their slots and the devices", async () => {
    const { houseId, washerId, dryerId } = await setupHouse();

    await createBooking(member(), {
      houseId,
      machineId: washerId,
      startMs: futureSlot(2),
      endMs: futureSlot(3),
    });
    await registerDevice(member(), { houseId, token: "tok-mo" });

    // Another housemate's things, which must survive untouched.
    await createBooking(other(), {
      houseId,
      machineId: dryerId,
      startMs: futureSlot(2),
      endMs: futureSlot(3),
    });
    await registerDevice(other(), { houseId, token: "tok-olu" });

    const result = await leaveHouse(member(), { houseId });
    expect(result).toEqual({ bookingsCancelled: 1 });

    expect(await readMember(houseId, MEMBER)).toBeUndefined();
    expect(await readPointer(MEMBER)).toMatchObject({ houseId: null });

    const bookings = await listBookings(houseId);
    expect(bookings.length).toBe(1);
    expect(bookings[0].data().uid).toBe(OTHER);

    const slots = await listSlots(houseId);
    expect(slots.length).toBe(4); // only the other member's hour remains
    expect(slots.every((slot) => slot.data().uid === OTHER)).toBe(true);

    const devices = await listDevices(houseId);
    expect(devices.length).toBe(1);
    expect(devices[0].data().uid).toBe(OTHER);
  });

  it("reports nothing cancelled when there was nothing booked", async () => {
    const { houseId } = await setupHouse();
    expect(await leaveHouse(member(), { houseId })).toEqual({ bookingsCancelled: 0 });
    expect(await readMember(houseId, MEMBER)).toBeUndefined();
  });

  it("refuses the admin, so a house is never left without one", async () => {
    const { houseId } = await setupHouse();
    await expectLaundryError(leaveHouse(admin(), { houseId }), "cannot leave");
    expect(await readMember(houseId, ADMIN)).toMatchObject({ role: "admin" });
    expect(await readPointer(ADMIN)).toMatchObject({ houseId });
  });

  it("refuses while your own cycle is running, and allows it once freed", async () => {
    const { houseId, washerId } = await setupHouse();
    await startSession(member(), { houseId, machineId: washerId, minutes: 30 });

    await expectLaundryError(leaveHouse(member(), { houseId }), "Washer");
    await expectLaundryError(leaveHouse(member(), { houseId }), "before you leave");
    expect(await readMember(houseId, MEMBER)).toBeDefined();

    await endSession(member(), { houseId, machineId: washerId });
    await expect(leaveHouse(member(), { houseId })).resolves.toEqual({
      bookingsCancelled: 0,
    });
    expect(await readMember(houseId, MEMBER)).toBeUndefined();
  });

  it("does not let somebody else's running cycle keep you in", async () => {
    const { houseId, washerId } = await setupHouse();
    await startSession(other(), { houseId, machineId: washerId, minutes: 30 });

    await expect(leaveHouse(member(), { houseId })).resolves.toEqual({
      bookingsCancelled: 0,
    });
  });

  it("refuses a stranger", async () => {
    const { houseId } = await setupHouse();
    await expectLaundryError(leaveHouse(stranger(), { houseId }), "not a member");
  });
});

describe("clearHousePointer", () => {
  it("is a no-op without a pointer", async () => {
    await expect(clearHousePointer(stranger())).resolves.toBeUndefined();
    expect(await readPointer(STRANGER)).toBeUndefined();
  });

  it("refuses while still a member", async () => {
    const { houseId } = await setupHouse();
    await expectLaundryError(clearHousePointer(member()), "still a member");
    expect((await readPointer(MEMBER))?.houseId).toBe(houseId);
  });

  it("clears the pointer once the admin has removed the member", async () => {
    const { houseId } = await setupHouse();
    await removeMember(admin(), { houseId, uid: MEMBER });
    await clearHousePointer(member());
    expect((await readPointer(MEMBER))?.houseId).toBeNull();
    // After that a fresh join works again.
    const { code } = { code: (await readHouse(houseId)).inviteCode };
    await joinHouse(member(), { code, displayName: "Mo", group: "Upstairs" });
    expect((await readPointer(MEMBER))?.houseId).toBe(houseId);
  });
});

/* ------------------------------------------------------------------ machines */

describe("startSession", () => {
  it("marks the machine in use with a minimal session", async () => {
    const { houseId, washerId } = await setupHouse();
    const before = Date.now();
    await startSession(member(), { houseId, machineId: washerId, minutes: 45 });

    const machine = (await readMachine(houseId, washerId))!;
    expect(machine.status).toBe("in_use");
    const session = machine.currentSession!;
    expect(session.uid).toBe(MEMBER);
    expect(session.displayName).toBe("Mo");
    expect(session.startedAt.toMillis()).toBeGreaterThanOrEqual(before - 1000);
    expect(session.expectedEndAt.toMillis() - session.startedAt.toMillis()).toBe(
      45 * 60_000,
    );

    expect(Object.keys(session).sort()).toEqual([
      "displayName",
      "expectedEndAt",
      "sessionId",
      "startedAt",
      "uid",
    ]);

    // The log entry that the History page reads, pointed at by the machine.
    const logs = await listSessions(houseId);
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe(session.sessionId);
    const log = logs[0].data();
    expect(log).toMatchObject({ machineId: washerId, uid: MEMBER, displayName: "Mo" });
    expect(log.endedAt).toBeNull();
    expect((log.startedAt as Timestamp).toMillis()).toBe(session.startedAt.toMillis());
    expect((log.expectedEndAt as Timestamp).toMillis()).toBe(
      session.expectedEndAt.toMillis(),
    );
  });

  it("rejects bad durations, unknown machines and non-members", async () => {
    const { houseId, washerId } = await setupHouse();
    for (const minutes of [0, 601, 1.5, Number.NaN]) {
      await expectLaundryError(
        startSession(member(), { houseId, machineId: washerId, minutes }),
        "between 1 and 600",
      );
    }
    await expectLaundryError(
      startSession(member(), { houseId, machineId: "nope", minutes: 30 }),
      "no longer exists",
    );
    await expectLaundryError(
      startSession(stranger(), { houseId, machineId: washerId, minutes: 30 }),
      "not a member",
    );
    expect((await readMachine(houseId, washerId))!.status).toBe("free");
  });

  it("caps the cycle at the machine's own maximum", async () => {
    const { houseId, washerId } = await setupHouse();

    // Default washer: 120 minutes.
    await expectLaundryError(
      startSession(member(), { houseId, machineId: washerId, minutes: 121 }),
      "Washer runs at most 120 minutes",
    );
    expect((await readMachine(houseId, washerId))!.status).toBe("free");
    await startSession(member(), { houseId, machineId: washerId, minutes: 120 });
    await endSession(member(), { houseId, machineId: washerId });

    // Admin lowers it to 60.
    await updateMachineCycles(admin(), {
      houseId,
      machineId: washerId,
      cycles: [{ name: "Normal", minutes: 45 }],
      maxMinutes: 60,
    });
    await expectLaundryError(
      startSession(member(), { houseId, machineId: washerId, minutes: 61 }),
      "runs at most 60 minutes",
    );
    expect((await readMachine(houseId, washerId))!.status).toBe("free");
    await startSession(member(), { houseId, machineId: washerId, minutes: 60 });
    expect((await readMachine(houseId, washerId))!.status).toBe("in_use");
  });

  it("refuses a machine that is already running", async () => {
    const { houseId, washerId } = await setupHouse();
    await startSession(member(), { houseId, machineId: washerId, minutes: 60 });
    await expectLaundryError(
      startSession(other(), { houseId, machineId: washerId, minutes: 60 }),
      "was just claimed by Mo",
    );
    expect((await readMachine(houseId, washerId))!.currentSession!.uid).toBe(MEMBER);
  });

  it("RACE: two members pressing Start at once: exactly one wins", async () => {
    const { houseId, washerId } = await setupHouse();
    const results = await Promise.allSettled([
      startSession(member(), { houseId, machineId: washerId, minutes: 60 }),
      startSession(other(), { houseId, machineId: washerId, minutes: 60 }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(LaundryError);
    expect(rejected[0].reason.message).toContain("was just claimed by");

    const machine = (await readMachine(houseId, washerId))!;
    expect(machine.status).toBe("in_use");
    expect([MEMBER, OTHER]).toContain(machine.currentSession!.uid);
  });
});

describe("endSession", () => {
  async function seedRunning(
    houseId: string,
    machineId: string,
    uid: string,
    expectedEndMs: number,
  ) {
    await raw(async (db) => {
      await setDoc(doc(db, "houses", houseId, "machines", machineId), {
        name: "Washer",
        type: "washer",
        status: "in_use",
        currentSession: {
          uid,
          displayName: "Mo",
          startedAt: Timestamp.fromMillis(expectedEndMs - 3_600_000),
          expectedEndAt: Timestamp.fromMillis(expectedEndMs),
        },
      });
    });
  }

  it("lets the owner end a running cycle any time", async () => {
    const { houseId, washerId } = await setupHouse();
    await startSession(member(), { houseId, machineId: washerId, minutes: 90 });

    await endSession(member(), { houseId, machineId: washerId });

    const machine = (await readMachine(houseId, washerId))!;
    expect(machine.status).toBe("free");
    expect(machine.currentSession).toBeNull();
  });

  it("stamps endedAt on the log entry", async () => {
    const { houseId, washerId } = await setupHouse();
    await startSession(member(), { houseId, machineId: washerId, minutes: 45 });
    const sessionId = (await readMachine(houseId, washerId))!.currentSession!.sessionId;

    const before = Date.now();
    await endSession(member(), { houseId, machineId: washerId });

    const log = (await readSession(houseId, sessionId))!;
    expect(log.endedAt).not.toBeNull();
    expect((log.endedAt as Timestamp).toMillis()).toBeGreaterThanOrEqual(before - 1000);
    // The rest of the entry is untouched, so the log still says who ran what.
    expect(log).toMatchObject({ machineId: washerId, uid: MEMBER, displayName: "Mo" });
  });

  it("still frees the machine when the log entry was already pruned", async () => {
    const { houseId, washerId } = await setupHouse();
    await startSession(member(), { houseId, machineId: washerId, minutes: 45 });
    const sessionId = (await readMachine(houseId, washerId))!.currentSession!.sessionId;
    await raw(async (db) => deleteDoc(doc(db, "houses", houseId, "sessions", sessionId)));

    await expect(
      endSession(member(), { houseId, machineId: washerId }),
    ).resolves.toBeUndefined();
    const machine = (await readMachine(houseId, washerId))!;
    expect(machine.status).toBe("free");
    expect(machine.currentSession).toBeNull();
  });

  it("stops another member before the cycle finishes", async () => {
    const { houseId, washerId } = await setupHouse();
    await startSession(member(), { houseId, machineId: washerId, minutes: 90 });
    await expectLaundryError(
      endSession(other(), { houseId, machineId: washerId }),
      "can stop this cycle",
    );
    expect((await readMachine(houseId, washerId))!.status).toBe("in_use");
  });

  it("lets another member empty it after the cycle has finished", async () => {
    const { houseId, washerId } = await setupHouse();
    await seedRunning(houseId, washerId, MEMBER, Date.now() - 5 * 60_000);
    await endSession(other(), { houseId, machineId: washerId });
    const machine = (await readMachine(houseId, washerId))!;
    expect(machine.status).toBe("free");
    expect(machine.currentSession).toBeNull();
  });

  it("lets the admin end any cycle", async () => {
    const { houseId, washerId } = await setupHouse();
    await startSession(member(), { houseId, machineId: washerId, minutes: 90 });
    await endSession(admin(), { houseId, machineId: washerId });
    expect((await readMachine(houseId, washerId))!.status).toBe("free");
  });

  it("is a no-op on a free machine and refuses non-members", async () => {
    const { houseId, washerId } = await setupHouse();
    await expect(
      endSession(member(), { houseId, machineId: washerId }),
    ).resolves.toBeUndefined();
    await expectLaundryError(
      endSession(stranger(), { houseId, machineId: washerId }),
      "not a member",
    );
    await expectLaundryError(
      endSession(member(), { houseId, machineId: "nope" }),
      "no longer exists",
    );
  });
});

/* ------------------------------------------------------------------ bookings */

describe("createBooking", () => {
  it("creates the booking and one slot per 15 minutes", async () => {
    const { houseId, washerId } = await setupHouse();
    const startMs = futureSlot(1);
    const endMs = startMs + 90 * 60_000;

    const { bookingId } = await createBooking(member(), {
      houseId,
      machineId: washerId,
      startMs,
      endMs,
    });

    const booking = await raw(async (db) =>
      (await getDoc(doc(db, "houses", houseId, "bookings", bookingId))).data(),
    );
    expect(booking).toMatchObject({
      machineId: washerId,
      uid: MEMBER,
      displayName: "Mo",
    });
    expect((booking!.startAt as Timestamp).toMillis()).toBe(startMs);
    expect((booking!.endAt as Timestamp).toMillis()).toBe(endMs);

    const slots = await listSlots(houseId);
    expect(slots).toHaveLength(6);
    const expectedIds = slotIdsForRange(washerId, new Date(startMs), new Date(endMs));
    expect(slots.map((s) => s.id).sort()).toEqual([...expectedIds].sort());
    expect(
      slots.every((s) => s.data().bookingId === bookingId && s.data().uid === MEMBER),
    ).toBe(true);
    expect(slots.map((s) => s.data().slotIndex).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it("rejects invalid ranges, unknown machines and non-members", async () => {
    const { houseId, washerId } = await setupHouse();
    const startMs = futureSlot(1);
    const book = (ctx: ServerContext, machineId: string, s: number, e: number) =>
      createBooking(ctx, { houseId, machineId, startMs: s, endMs: e });

    await expectLaundryError(
      book(member(), washerId, startMs, startMs),
      "after the start",
    );
    await expectLaundryError(
      book(member(), washerId, startMs + SLOT_MS, startMs),
      "after the start",
    );
    await expectLaundryError(
      book(member(), washerId, startMs + 60_000, startMs + SLOT_MS + 60_000),
      "15-minute steps",
    );
    await expectLaundryError(
      book(member(), washerId, startMs, startMs + (MAX_BOOKING_MINUTES + 15) * 60_000),
      "at most 6 hours",
    );
    const past = Math.floor(Date.now() / SLOT_MS) * SLOT_MS - 2 * 3_600_000;
    await expectLaundryError(
      book(member(), washerId, past, past + SLOT_MS),
      "already in the past",
    );
    await expectLaundryError(
      book(member(), washerId, Number.NaN, startMs),
      "Pick a start",
    );
    await expectLaundryError(
      book(member(), "nope", startMs, startMs + SLOT_MS),
      "no longer exists",
    );
    await expectLaundryError(
      book(stranger(), washerId, startMs, startMs + SLOT_MS),
      "not a member",
    );

    expect(await listBookings(houseId)).toHaveLength(0);
    expect(await listSlots(houseId)).toHaveLength(0);
  });

  it("refuses an overlap of even one slot and names the other person", async () => {
    const { houseId, washerId } = await setupHouse();
    const startMs = futureSlot(1);
    await createBooking(member(), {
      houseId,
      machineId: washerId,
      startMs,
      endMs: startMs + 3_600_000,
    });
    await expectLaundryError(
      createBooking(other(), {
        houseId,
        machineId: washerId,
        startMs: startMs + 45 * 60_000,
        endMs: startMs + 2 * 3_600_000,
      }),
      "overlaps a booking by Mo",
    );
    expect(await listBookings(houseId)).toHaveLength(1);
    expect(await listSlots(houseId)).toHaveLength(4);
  });

  it("allows adjacent bookings and the same time on another machine", async () => {
    const { houseId, washerId, dryerId } = await setupHouse();
    const ten = tomorrowAt("10:00");
    const eleven = tomorrowAt("11:00");
    const twelve = tomorrowAt("12:00");
    await createBooking(member(), {
      houseId,
      machineId: washerId,
      startMs: ten,
      endMs: eleven,
    });
    await createBooking(other(), {
      houseId,
      machineId: washerId,
      startMs: eleven,
      endMs: twelve,
    });
    await createBooking(other(), {
      houseId,
      machineId: dryerId,
      startMs: ten,
      endMs: eleven,
    });
    expect(await listBookings(houseId)).toHaveLength(3);
    expect(await listSlots(houseId)).toHaveLength(12);
  });

  it("RACE: two members booking the same slot at once: exactly one wins", async () => {
    const { houseId, washerId } = await setupHouse();
    const startMs = futureSlot(2);
    const endMs = startMs + 3_600_000;
    const results = await Promise.allSettled([
      createBooking(member(), { houseId, machineId: washerId, startMs, endMs }),
      createBooking(other(), {
        houseId,
        machineId: washerId,
        startMs: startMs + SLOT_MS,
        endMs: endMs + SLOT_MS,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(LaundryError);
    expect(rejected[0].reason.message).toContain("overlaps a booking by");

    const bookings = await listBookings(houseId);
    const slots = await listSlots(houseId);
    expect(bookings).toHaveLength(1);
    expect(slots).toHaveLength(4);
    expect(slots.every((s) => s.data().bookingId === bookings[0].id)).toBe(true);
  });
});

describe("pruneOldRecords", () => {
  async function seedBooking(
    houseId: string,
    machineId: string,
    uid: string,
    startMs: number,
    endMs: number,
    id: string,
  ) {
    await raw(async (db) => {
      const startAt = Timestamp.fromMillis(startMs);
      const endAt = Timestamp.fromMillis(endMs);
      await setDoc(doc(db, "houses", houseId, "bookings", id), {
        machineId,
        uid,
        displayName: uid,
        startAt,
        endAt,
        createdAt: Timestamp.now(),
      });
      const ids = slotIdsForRange(machineId, new Date(startMs), new Date(endMs));
      await Promise.all(
        ids.map((slotId, slotIndex) =>
          setDoc(doc(db, "houses", houseId, "slots", slotId), {
            bookingId: id,
            machineId,
            uid,
            displayName: uid,
            startAt,
            endAt,
            slotIndex,
          }),
        ),
      );
      return ids;
    });
  }

  const DAY = 24 * 3_600_000;

  async function seedSession(
    houseId: string,
    machineId: string,
    uid: string,
    startedMs: number,
    id: string,
  ) {
    await raw(async (db) => {
      await setDoc(doc(db, "houses", houseId, "sessions", id), {
        machineId,
        uid,
        displayName: uid,
        startedAt: Timestamp.fromMillis(startedMs),
        expectedEndAt: Timestamp.fromMillis(startedMs + 3_600_000),
        endedAt: Timestamp.fromMillis(startedMs + 3_600_000),
      });
    });
  }

  it("sweeps past bookings and log entries older than a week", async () => {
    const { houseId, washerId, dryerId } = await setupHouse();
    const pastStart = Math.floor((Date.now() - 4 * 3_600_000) / SLOT_MS) * SLOT_MS;
    await seedBooking(houseId, washerId, MEMBER, pastStart, pastStart + 3_600_000, "p1");
    await seedBooking(houseId, dryerId, OTHER, pastStart, pastStart + 1_800_000, "p2");
    const future = futureSlot(2);
    await seedBooking(houseId, washerId, MEMBER, future, future + 3_600_000, "f1");

    await seedSession(houseId, washerId, MEMBER, Date.now() - 8 * DAY, "old1");
    await seedSession(houseId, dryerId, OTHER, Date.now() - 9 * DAY, "old2");
    await seedSession(houseId, washerId, MEMBER, Date.now() - 6 * DAY, "keep1");
    await seedSession(houseId, dryerId, OTHER, Date.now() - 3_600_000, "keep2");

    expect(await listBookings(houseId)).toHaveLength(3);
    expect(await listSlots(houseId)).toHaveLength(4 + 2 + 4);
    expect(await listSessions(houseId)).toHaveLength(4);

    await expect(pruneOldRecords(admin(), { houseId })).resolves.toEqual({
      bookings: 2,
      sessions: 2,
    });

    const bookings = await listBookings(houseId);
    expect(bookings.map((b) => b.id)).toEqual(["f1"]);
    const slots = await listSlots(houseId);
    expect(slots).toHaveLength(4);
    expect(slots.every((slot) => slot.data().bookingId === "f1")).toBe(true);

    const sessions = await listSessions(houseId);
    expect(sessions.map((entry) => entry.id).sort()).toEqual(["keep1", "keep2"]);
  });

  it("returns zeroes when nothing has expired and refuses strangers", async () => {
    const { houseId, washerId } = await setupHouse();
    const future = futureSlot(2);
    await seedBooking(houseId, washerId, MEMBER, future, future + 3_600_000, "f1");
    await seedSession(houseId, washerId, MEMBER, Date.now() - 2 * DAY, "keep1");

    await expect(pruneOldRecords(member(), { houseId })).resolves.toEqual({
      bookings: 0,
      sessions: 0,
    });
    await expectLaundryError(pruneOldRecords(stranger(), { houseId }), "not a member");
    expect(await listBookings(houseId)).toHaveLength(1);
    expect(await listSessions(houseId)).toHaveLength(1);
  });
});

describe("start blocked by a booking", () => {
  /** A booking that covers this very moment, so a cycle started now would run into it. */
  const nowWindow = () => {
    const startMs = snapToSlot(new Date()).getTime();
    return { startMs, endMs: startMs + 2 * 3_600_000 };
  };

  it("refuses a cycle that runs into someone else's booking", async () => {
    const { houseId, washerId } = await setupHouse();
    const { startMs, endMs } = nowWindow();
    await createBooking(member(), { houseId, machineId: washerId, startMs, endMs });

    await expectLaundryError(
      startSession(other(), { houseId, machineId: washerId, minutes: 30 }),
      "is booked by Mo",
    );
    // The message names the machine and when the slot frees up.
    await expect(
      startSession(other(), { houseId, machineId: washerId, minutes: 30 }),
    ).rejects.toThrow(
      `Washer is booked by Mo until ${formatTime(new Date(endMs))}. Pick a shorter cycle or wait for their slot.`,
    );
    expect((await readMachine(houseId, washerId))!.status).toBe("free");
    expect(await listSessions(houseId)).toHaveLength(0);
  });

  it("lets the person who booked it start their own cycle", async () => {
    const { houseId, washerId } = await setupHouse();
    const { startMs, endMs } = nowWindow();
    await createBooking(member(), { houseId, machineId: washerId, startMs, endMs });

    await startSession(member(), { houseId, machineId: washerId, minutes: 30 });
    const machine = (await readMachine(houseId, washerId))!;
    expect(machine.status).toBe("in_use");
    expect(machine.currentSession!.uid).toBe(MEMBER);
  });

  it("allows a cycle that finishes before the booking starts", async () => {
    const { houseId, washerId } = await setupHouse();
    const startMs = futureSlot(2);
    await createBooking(member(), {
      houseId,
      machineId: washerId,
      startMs,
      endMs: startMs + 3_600_000,
    });

    await startSession(other(), { houseId, machineId: washerId, minutes: 30 });
    expect((await readMachine(houseId, washerId))!.currentSession!.uid).toBe(OTHER);
  });
});

describe("createBooking slot locks", () => {
  it("stamps endAt on every slot so expired ones can be swept", async () => {
    const { houseId, washerId } = await setupHouse();
    const startMs = futureSlot(1);
    const endMs = startMs + 3_600_000;
    await createBooking(member(), { houseId, machineId: washerId, startMs, endMs });
    const slots = await listSlots(houseId);
    expect(slots).toHaveLength(4);
    for (const slot of slots) {
      expect((slot.data().endAt as Timestamp).toMillis()).toBe(endMs);
    }
  });
});

describe("cancelBooking", () => {
  async function bookOne(fx: Fixture) {
    const startMs = futureSlot(1);
    const { bookingId } = await createBooking(member(), {
      houseId: fx.houseId,
      machineId: fx.washerId,
      startMs,
      endMs: startMs + 3_600_000,
    });
    return bookingId;
  }

  it("lets the owner cancel, removing every slot", async () => {
    const fx = await setupHouse();
    const bookingId = await bookOne(fx);
    await cancelBooking(member(), { houseId: fx.houseId, bookingId });
    expect(await listBookings(fx.houseId)).toHaveLength(0);
    expect(await listSlots(fx.houseId)).toHaveLength(0);
  });

  it("refuses another member but lets the admin cancel", async () => {
    const fx = await setupHouse();
    const bookingId = await bookOne(fx);
    await expectLaundryError(
      cancelBooking(other(), { houseId: fx.houseId, bookingId }),
      "only cancel your own",
    );
    expect(await listSlots(fx.houseId)).toHaveLength(4);
    await cancelBooking(admin(), { houseId: fx.houseId, bookingId });
    expect(await listBookings(fx.houseId)).toHaveLength(0);
    expect(await listSlots(fx.houseId)).toHaveLength(0);
  });

  it("is a no-op for an unknown booking and refuses non-members", async () => {
    const fx = await setupHouse();
    await expect(
      cancelBooking(member(), { houseId: fx.houseId, bookingId: "nope" }),
    ).resolves.toBeUndefined();
    await expectLaundryError(
      cancelBooking(stranger(), { houseId: fx.houseId, bookingId: "nope" }),
      "not a member",
    );
  });

  it("frees the slots for somebody else afterwards", async () => {
    const fx = await setupHouse();
    const bookingId = await bookOne(fx);
    const startMs = futureSlot(1);
    await expectLaundryError(
      createBooking(other(), {
        houseId: fx.houseId,
        machineId: fx.washerId,
        startMs,
        endMs: startMs + SLOT_MS,
      }),
      "overlaps",
    );
    await cancelBooking(member(), { houseId: fx.houseId, bookingId });
    await createBooking(other(), {
      houseId: fx.houseId,
      machineId: fx.washerId,
      startMs,
      endMs: startMs + SLOT_MS,
    });
    expect(await listSlots(fx.houseId)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ admin settings */

describe("machines admin", () => {
  it("adds, renames and removes machines as admin", async () => {
    const { houseId } = await setupHouse();
    const { machineId } = await addMachine(admin(), {
      houseId,
      name: " Big dryer ",
      type: "dryer",
    });
    expect(await readMachine(houseId, machineId)).toEqual({
      name: "Big dryer",
      type: "dryer",
      status: "free",
      currentSession: null,
      cycles: DEFAULT_CYCLES.dryer,
      maxMinutes: DEFAULT_MAX_MINUTES.dryer,
      order: 2, // appended after the two default machines
    });

    await renameMachine(admin(), { houseId, machineId, name: "Tumble" });
    expect((await readMachine(houseId, machineId))!.name).toBe("Tumble");

    const combo = await addMachine(admin(), {
      houseId,
      name: "All-in-one",
      type: "combo",
    });
    expect((await readMachine(houseId, combo.machineId))!.type).toBe("combo");

    await removeMachine(admin(), { houseId, machineId });
    expect(await readMachine(houseId, machineId)).toBeUndefined();
    await expect(removeMachine(admin(), { houseId, machineId })).resolves.toBeUndefined();
  });

  it("validates input and refuses removal while in use", async () => {
    const { houseId, washerId } = await setupHouse();
    await expectLaundryError(
      addMachine(admin(), { houseId, name: " ", type: "washer" }),
      "Give the machine a name",
    );
    await expectLaundryError(
      addMachine(admin(), { houseId, name: "X", type: "toaster" as MachineTypeLoose }),
      "Unknown machine type",
    );
    await expectLaundryError(
      renameMachine(admin(), { houseId, machineId: washerId, name: "" }),
      "Give the machine a name",
    );

    await startSession(member(), { houseId, machineId: washerId, minutes: 30 });
    await expectLaundryError(
      removeMachine(admin(), { houseId, machineId: washerId }),
      "Stop the running cycle",
    );
    expect(await readMachine(houseId, washerId)).toBeDefined();
  });

  it("refuses non-admins", async () => {
    const { houseId, washerId } = await setupHouse();
    await expectLaundryError(
      addMachine(member(), { houseId, name: "X", type: "washer" }),
      "Only the house admin",
    );
    await expectLaundryError(
      renameMachine(member(), { houseId, machineId: washerId, name: "X" }),
      "Only the house admin",
    );
    await expectLaundryError(
      removeMachine(member(), { houseId, machineId: washerId }),
      "Only the house admin",
    );
    await expectLaundryError(
      addMachine(stranger(), { houseId, name: "X", type: "washer" }),
      "not a member",
    );
    expect((await readMachine(houseId, washerId))!.name).toBe("Washer");
  });
});
type MachineTypeLoose = "washer" | "dryer";

describe("updateMachineCycles", () => {
  it("stores trimmed names and the custom limit", async () => {
    const { houseId, washerId } = await setupHouse();
    await updateMachineCycles(admin(), {
      houseId,
      machineId: washerId,
      cycles: [
        { name: " Quick ", minutes: 30 },
        { name: "Heavy", minutes: 90 },
      ],
      maxMinutes: 120,
    });
    const machine = (await readMachine(houseId, washerId))!;
    expect(machine.cycles).toEqual([
      { name: "Quick", minutes: 30 },
      { name: "Heavy", minutes: 90 },
    ]);
    expect(machine.maxMinutes).toBe(120);
    // Nothing else on the document changed.
    expect(machine.name).toBe("Washer");
    expect(machine.status).toBe("free");
  });

  it("validates the limit, the list and each cycle", async () => {
    const { houseId, washerId } = await setupHouse();
    const ok = [{ name: "Normal", minutes: 45 }];
    const attempt = (cycles: { name: string; minutes: number }[], maxMinutes = 120) =>
      updateMachineCycles(admin(), { houseId, machineId: washerId, cycles, maxMinutes });

    for (const maxMinutes of [14, 601, 60.5, Number.NaN]) {
      await expectLaundryError(attempt(ok, maxMinutes), "between 15 and 600");
    }
    await expectLaundryError(attempt([]), "Keep at least one cycle");
    await expectLaundryError(
      attempt(Array.from({ length: 7 }, (_, i) => ({ name: `C${i}`, minutes: 30 }))),
      "At most 6 cycles",
    );
    await expectLaundryError(
      attempt([{ name: "   ", minutes: 30 }]),
      "1 to 24 characters",
    );
    await expectLaundryError(
      attempt([{ name: "x".repeat(25), minutes: 30 }]),
      "1 to 24 characters",
    );
    await expectLaundryError(
      attempt([{ name: "Long", minutes: 121 }], 120),
      '"Long" has to be between 1 and 120',
    );
    await expectLaundryError(
      attempt([{ name: "Zero", minutes: 0 }]),
      "between 1 and 120",
    );
    await expectLaundryError(
      attempt([{ name: "Half", minutes: 30.5 }]),
      "between 1 and 120",
    );
    await expectLaundryError(
      attempt([
        { name: "Normal", minutes: 45 },
        { name: "normal", minutes: 60 },
      ]),
      "have to be unique",
    );

    // Nothing was written by any of the failed attempts.
    expect((await readMachine(houseId, washerId))!.cycles).toEqual(DEFAULT_CYCLES.washer);
    expect((await readMachine(houseId, washerId))!.maxMinutes).toBe(
      DEFAULT_MAX_MINUTES.washer,
    );
  });

  it("refuses non-admins and unknown machines", async () => {
    const { houseId, washerId } = await setupHouse();
    const ok = [{ name: "Normal", minutes: 45 }];
    await expectLaundryError(
      updateMachineCycles(member(), {
        houseId,
        machineId: washerId,
        cycles: ok,
        maxMinutes: 120,
      }),
      "Only the house admin",
    );
    await expectLaundryError(
      updateMachineCycles(stranger(), {
        houseId,
        machineId: washerId,
        cycles: ok,
        maxMinutes: 120,
      }),
      "not a member",
    );
    await expectLaundryError(
      updateMachineCycles(admin(), {
        houseId,
        machineId: "ghost",
        cycles: ok,
        maxMinutes: 120,
      }),
      "no longer exists",
    );
    expect((await readMachine(houseId, washerId))!.cycles).toEqual(DEFAULT_CYCLES.washer);
  });
});

describe("reorderMachines", () => {
  it("stores the dragged order as `order` = position", async () => {
    const { houseId, washerId, dryerId } = await setupHouse();
    await reorderMachines(admin(), { houseId, machineIds: [dryerId, washerId] });
    expect((await readMachine(houseId, dryerId))!.order).toBe(0);
    expect((await readMachine(houseId, washerId))!.order).toBe(1);

    await reorderMachines(admin(), { houseId, machineIds: [washerId, dryerId] });
    expect((await readMachine(houseId, washerId))!.order).toBe(0);
    expect((await readMachine(houseId, dryerId))!.order).toBe(1);
  });

  it("rejects incomplete, duplicated or unknown lists and non-admins", async () => {
    const { houseId, washerId, dryerId } = await setupHouse();
    await expectLaundryError(
      reorderMachines(admin(), { houseId, machineIds: [] }),
      "Nothing to reorder",
    );
    await expectLaundryError(
      reorderMachines(admin(), { houseId, machineIds: [washerId, washerId] }),
      "only appear once",
    );
    await expectLaundryError(
      reorderMachines(admin(), { houseId, machineIds: [washerId] }),
      "machine list changed",
    );
    await expectLaundryError(
      reorderMachines(admin(), { houseId, machineIds: [washerId, dryerId, "ghost"] }),
      "machine list changed",
    );
    await expectLaundryError(
      reorderMachines(member(), { houseId, machineIds: [dryerId, washerId] }),
      "Only the house admin",
    );
    // The default washer is created at position 0 and none of the refused calls moved it.
    expect((await readMachine(houseId, washerId))!.order).toBe(0);
  });
});

describe("updateSchedule", () => {
  it("stores the schedule and nulls unknown groups", async () => {
    const { houseId } = await setupHouse();
    const schedule = {
      mon: "Downstairs",
      tue: "Attic",
      wed: null,
      thu: "Upstairs",
      fri: null,
      sat: "Downstairs",
      sun: "Nobody",
    } as Schedule;
    await updateSchedule(admin(), { houseId, schedule });
    expect((await readHouse(houseId)).schedule).toEqual({
      mon: "Downstairs",
      tue: null,
      wed: null,
      thu: "Upstairs",
      fri: null,
      sat: "Downstairs",
      sun: null,
    });
  });

  it("refuses non-admins", async () => {
    const { houseId } = await setupHouse();
    const before = (await readHouse(houseId)).schedule;
    await expectLaundryError(
      updateSchedule(member(), { houseId, schedule: before }),
      "Only the house admin",
    );
  });
});

describe("updateScheduleSettings", () => {
  it("lets the admin set each mode and the zone", async () => {
    const { houseId } = await setupHouse();
    for (const scheduleMode of ["open", "strict", "soft"] as ScheduleMode[]) {
      await updateScheduleSettings(admin(), {
        houseId,
        scheduleMode,
        timeZone: "Asia/Tokyo",
      });
      const house = await readHouse(houseId);
      expect(house.scheduleMode).toBe(scheduleMode);
      expect(house.timeZone).toBe("Asia/Tokyo");
    }
  });

  it("validates the mode and the zone", async () => {
    const { houseId } = await setupHouse();
    await expectLaundryError(
      updateScheduleSettings(admin(), {
        houseId,
        scheduleMode: "chaos" as ScheduleMode,
        timeZone: "UTC",
      }),
      "Unknown schedule mode",
    );
    await expectLaundryError(
      updateScheduleSettings(admin(), {
        houseId,
        scheduleMode: "strict",
        timeZone: "Mars/Olympus",
      }),
      "isn't recognised",
    );
    const house = await readHouse(houseId);
    expect(house.scheduleMode).toBe("soft");
    expect(house.timeZone).toBe("UTC");
  });

  it("refuses non-admins", async () => {
    const { houseId } = await setupHouse();
    await expectLaundryError(
      updateScheduleSettings(member(), {
        houseId,
        scheduleMode: "open",
        timeZone: "UTC",
      }),
      "Only the house admin",
    );
  });
});

/** A schedule where only `day` is owned (by `owner`); every other day is open. */
function onlyDayOwnedBy(day: Weekday, owner: string): Schedule {
  return Object.fromEntries(
    WEEKDAYS.map((d) => [d, d === day ? owner : null]),
  ) as Schedule;
}

/**
 * Puts the house in `mode` (UTC) with today's UTC weekday owned by `owner`. Fixture
 * members: admin Ada and Mo are Upstairs, Olu is Downstairs.
 */
async function houseInMode(houseId: string, mode: ScheduleMode, owner: string) {
  const today = weekdayOf(new Date(), "UTC");
  await updateSchedule(admin(), { houseId, schedule: onlyDayOwnedBy(today, owner) });
  await updateScheduleSettings(admin(), { houseId, scheduleMode: mode, timeZone: "UTC" });
}

/** The next slot boundary at least an hour away, and a start three days later. */
function bookingStarts() {
  const soon = futureSlot(1);
  return { soon, laterDay: soon + 3 * 24 * 3_600_000 };
}

describe("strict schedule mode", () => {
  it("refuses to start a machine on another group's day", async () => {
    const { houseId, washerId } = await setupHouse();
    await houseInMode(houseId, "strict", "Upstairs");
    await expectLaundryError(
      startSession(other(), { houseId, machineId: washerId, minutes: 45 }),
      "Only Upstairs",
    );
    expect((await readMachine(houseId, washerId))!.status).toBe("free");
  });

  it("lets the owning group start", async () => {
    const { houseId, washerId } = await setupHouse();
    await houseInMode(houseId, "strict", "Upstairs");
    await startSession(member(), { houseId, machineId: washerId, minutes: 45 });
    expect((await readMachine(houseId, washerId))!.status).toBe("in_use");
  });

  it("does not exempt the admin", async () => {
    const { houseId, washerId } = await setupHouse();
    await houseInMode(houseId, "strict", "Downstairs");
    await expectLaundryError(
      startSession(admin(), { houseId, machineId: washerId, minutes: 45 }),
      "Only Downstairs",
    );
  });

  it("refuses a booking that starts on another group's day", async () => {
    const { houseId, washerId } = await setupHouse();
    const { soon } = bookingStarts();
    // Own the day the booking starts on, whatever the clock says right now.
    await updateSchedule(admin(), {
      houseId,
      schedule: onlyDayOwnedBy(weekdayOf(new Date(soon), "UTC"), "Upstairs"),
    });
    await updateScheduleSettings(admin(), {
      houseId,
      scheduleMode: "strict",
      timeZone: "UTC",
    });

    await expectLaundryError(
      createBooking(other(), {
        houseId,
        machineId: washerId,
        startMs: soon,
        endMs: soon + 3_600_000,
      }),
      "Only Upstairs",
    );
    expect(await listBookings(houseId)).toHaveLength(0);
  });

  it("allows a booking on an open day, even for the other group", async () => {
    const { houseId, washerId } = await setupHouse();
    const { soon, laterDay } = bookingStarts();
    await updateSchedule(admin(), {
      houseId,
      schedule: onlyDayOwnedBy(weekdayOf(new Date(soon), "UTC"), "Upstairs"),
    });
    await updateScheduleSettings(admin(), {
      houseId,
      scheduleMode: "strict",
      timeZone: "UTC",
    });

    await createBooking(other(), {
      houseId,
      machineId: washerId,
      startMs: laterDay,
      endMs: laterDay + 3_600_000,
    });
    expect(await listBookings(houseId)).toHaveLength(1);
  });

  it("soft and open modes let anyone book the other group's day", async () => {
    for (const mode of ["soft", "open"] as ScheduleMode[]) {
      await testEnv.clearFirestore();
      const { houseId, washerId } = await setupHouse();
      const { soon } = bookingStarts();
      await updateSchedule(admin(), {
        houseId,
        schedule: onlyDayOwnedBy(weekdayOf(new Date(soon), "UTC"), "Upstairs"),
      });
      await updateScheduleSettings(admin(), {
        houseId,
        scheduleMode: mode,
        timeZone: "UTC",
      });

      await createBooking(other(), {
        houseId,
        machineId: washerId,
        startMs: soon,
        endMs: soon + 3_600_000,
      });
      expect(await listBookings(houseId)).toHaveLength(1);
      await startSession(other(), { houseId, machineId: washerId, minutes: 30 });
      expect((await readMachine(houseId, washerId))!.status).toBe("in_use");
    }
  });
});

describe("updateHouseDetails", () => {
  it("renames the house, keeps the invite doc in step, and moves orphaned members", async () => {
    const { houseId, code } = await setupHouse();
    await updateHouseDetails(admin(), {
      houseId,
      name: " New name ",
      groups: ["Downstairs", "Attic"],
    });

    const house = await readHouse(houseId);
    expect(house.name).toBe("New name");
    expect(house.groups).toEqual(["Downstairs", "Attic"]);
    // Upstairs owned mon/wed/fri in the default schedule; those are now open.
    expect(house.schedule).toEqual({
      mon: null,
      tue: "Downstairs",
      wed: null,
      thu: "Downstairs",
      fri: null,
      sat: "Downstairs",
      sun: null,
    });

    const invite = await raw(async (db) =>
      (await getDoc(doc(db, "inviteCodes", code))).data(),
    );
    expect(invite).toEqual({
      houseId,
      houseName: "New name",
      groups: ["Downstairs", "Attic"],
      requireApproval: false,
    });

    expect((await readMember(houseId, ADMIN))!.group).toBe("Downstairs"); // was Upstairs
    expect((await readMember(houseId, MEMBER))!.group).toBe("Downstairs"); // was Upstairs
    expect((await readMember(houseId, OTHER))!.group).toBe("Downstairs"); // unchanged
  });

  it("can rename a group, moving its members to the new name in the same batch", async () => {
    const { houseId } = await setupHouse();
    await updateHouseDetails(admin(), {
      houseId,
      name: "Test house",
      groups: ["Top floor", "Downstairs"],
    });
    expect((await readHouse(houseId)).groups).toEqual(["Top floor", "Downstairs"]);
    expect((await readMember(houseId, ADMIN))!.group).toBe("Top floor");
    expect((await readMember(houseId, MEMBER))!.group).toBe("Top floor");
    expect((await readMember(houseId, OTHER))!.group).toBe("Downstairs");
  });

  it("validates and refuses non-admins", async () => {
    const { houseId } = await setupHouse();
    await expectLaundryError(
      updateHouseDetails(admin(), { houseId, name: " ", groups: GROUPS }),
      "Give the house a name",
    );
    await expectLaundryError(
      updateHouseDetails(admin(), { houseId, name: "X", groups: [] }),
      "at least one group",
    );
    await expectLaundryError(
      updateHouseDetails(admin(), { houseId, name: "X", groups: ["A", "A"] }),
      "unique",
    );
    await expectLaundryError(
      updateHouseDetails(member(), { houseId, name: "X", groups: GROUPS }),
      "Only the house admin",
    );
    expect((await readHouse(houseId)).name).toBe("Test house");
  });
});

describe("updateMemberGroup / removeMember", () => {
  it("regroups a member and rejects unknown groups", async () => {
    const { houseId } = await setupHouse();
    await updateMemberGroup(admin(), { houseId, uid: MEMBER, group: "Downstairs" });
    expect((await readMember(houseId, MEMBER))!.group).toBe("Downstairs");
    await expectLaundryError(
      updateMemberGroup(admin(), { houseId, uid: MEMBER, group: "Attic" }),
      "doesn't exist",
    );
    await expectLaundryError(
      updateMemberGroup(member(), { houseId, uid: OTHER, group: "Upstairs" }),
      "Only the house admin",
    );
  });

  it("removes a member but never the admin", async () => {
    const { houseId } = await setupHouse();
    await removeMember(admin(), { houseId, uid: MEMBER });
    expect(await readMember(houseId, MEMBER)).toBeUndefined();
    await expectLaundryError(
      removeMember(admin(), { houseId, uid: ADMIN }),
      "admin cannot be removed",
    );
    expect(await readMember(houseId, ADMIN)).toBeDefined();
    await expectLaundryError(
      removeMember(other(), { houseId, uid: ADMIN }),
      "Only the house admin",
    );
  });
});

describe("regenerateInviteCode", () => {
  it("swaps the code on the house and in inviteCodes", async () => {
    const { houseId, code } = await setupHouse();
    const { code: next } = await regenerateInviteCode(admin(), { houseId });
    expect(next).not.toBe(code);
    expect(next).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect((await readHouse(houseId)).inviteCode).toBe(next);

    const old = await raw(async (db) => getDoc(doc(db, "inviteCodes", code)));
    expect(old.exists()).toBe(false);
    const fresh = await raw(async (db) =>
      (await getDoc(doc(db, "inviteCodes", next))).data(),
    );
    expect(fresh).toEqual({
      houseId,
      houseName: "Test house",
      groups: GROUPS,
      requireApproval: false,
    });

    await expectLaundryError(lookupInviteCode(stranger(), code), "No house found");
    await joinHouse(stranger(), { code: next, displayName: "Sky", group: "Upstairs" });
  });

  it("refuses non-admins", async () => {
    const { houseId, code } = await setupHouse();
    await expectLaundryError(
      regenerateInviteCode(member(), { houseId }),
      "Only the house admin",
    );
    expect((await readHouse(houseId)).inviteCode).toBe(code);
  });
});

// Keep the unused import honest: deleteDoc is handy when debugging a failing seed.
void deleteDoc;

describe("devices", () => {
  it("remembers a browser under an id derived from its token", async () => {
    const { houseId } = await setupHouse();
    const token = "fcm-token-for-mo:with/odd+characters";

    await registerDevice(member(), { houseId, token });

    const stored = (await readDevice(houseId, token))!;
    expect(stored).toMatchObject({ uid: MEMBER, token, displayName: "Mo" });
    expect(stored.updatedAt).toBeDefined();
  });

  it("updates rather than duplicating when the same token comes back", async () => {
    const { houseId } = await setupHouse();
    const token = "fcm-token-repeat";

    await registerDevice(member(), { houseId, token });
    await registerDevice(member(), { houseId, token });

    expect((await listDevices(houseId)).length).toBe(1);
  });

  it("keeps one entry per browser, per person", async () => {
    const { houseId } = await setupHouse();
    await registerDevice(member(), { houseId, token: "mo-phone" });
    await registerDevice(member(), { houseId, token: "mo-laptop" });
    await registerDevice(other(), { houseId, token: "olu-phone" });

    const devices = await listDevices(houseId);
    expect(devices.length).toBe(3);
    expect(devices.filter((d) => d.data().uid === MEMBER).length).toBe(2);
  });

  it("refuses a token that is blank or absurdly long", async () => {
    const { houseId } = await setupHouse();
    await expectLaundryError(
      registerDevice(member(), { houseId, token: "   " }),
      "doesn't look right",
    );
    await expectLaundryError(
      registerDevice(member(), { houseId, token: "x".repeat(4097) }),
      "doesn't look right",
    );
    expect((await listDevices(houseId)).length).toBe(0);
  });

  it("refuses a stranger", async () => {
    const { houseId } = await setupHouse();
    await expectLaundryError(
      registerDevice(stranger(), { houseId, token: "sky-phone" }),
      "not a member",
    );
    await expectLaundryError(
      unregisterDevice(stranger(), { houseId, token: "sky-phone" }),
      "not a member",
    );
  });

  it("forgets a browser again, and shrugs at one it never knew", async () => {
    const { houseId } = await setupHouse();
    await registerDevice(member(), { houseId, token: "mo-phone" });

    await unregisterDevice(member(), { houseId, token: "mo-phone" });
    expect(await readDevice(houseId, "mo-phone")).toBeUndefined();

    await expect(
      unregisterDevice(member(), { houseId, token: "never-seen" }),
    ).resolves.toBeUndefined();
  });
});

describe("notifyCycleFinished", () => {
  /** A real cycle, rewound so its expected end has already passed. */
  async function seedFinished(houseId: string, machineId: string) {
    await startSession(member(), { houseId, machineId, minutes: 45 });
    const machine = (await readMachine(houseId, machineId))!;
    const session = machine.currentSession!;
    await raw(async (db) => {
      await setDoc(doc(db, "houses", houseId, "machines", machineId), {
        ...machine,
        currentSession: {
          ...session,
          expectedEndAt: Timestamp.fromMillis(Date.now() - 60_000),
        },
      });
    });
    return session.sessionId;
  }

  it("says nothing when the machine is free, gone, or still running", async () => {
    const { houseId, washerId } = await setupHouse();

    expect(await notifyCycleFinished(member(), { houseId, machineId: washerId })).toEqual(
      {
        sent: 0,
      },
    );
    expect(
      await notifyCycleFinished(member(), { houseId, machineId: "no-such-machine" }),
    ).toEqual({ sent: 0 });

    await startSession(member(), { houseId, machineId: washerId, minutes: 90 });
    expect(await notifyCycleFinished(member(), { houseId, machineId: washerId })).toEqual(
      {
        sent: 0,
      },
    );
    const sessionId = (await readMachine(houseId, washerId))!.currentSession!.sessionId;
    expect((await readSession(houseId, sessionId))!.notifiedAt).toBeUndefined();
  });

  it("stamps the log entry once, however many phones notice", async () => {
    const { houseId, washerId } = await setupHouse();
    const sessionId = await seedFinished(houseId, washerId);

    // No FCM credentials in tests, so nothing is delivered; the claim is what matters.
    expect(await notifyCycleFinished(member(), { houseId, machineId: washerId })).toEqual(
      {
        sent: 0,
      },
    );
    const first = (await readSession(houseId, sessionId))!.notifiedAt as Timestamp;
    expect(first).toBeDefined();

    expect(await notifyCycleFinished(other(), { houseId, machineId: washerId })).toEqual({
      sent: 0,
    });
    const second = (await readSession(houseId, sessionId))!.notifiedAt as Timestamp;
    expect(second.toMillis()).toBe(first.toMillis());
  });

  it("can be raised by a housemate who did not start the cycle", async () => {
    const { houseId, washerId } = await setupHouse();
    const sessionId = await seedFinished(houseId, washerId);

    expect(await notifyCycleFinished(other(), { houseId, machineId: washerId })).toEqual({
      sent: 0,
    });
    expect((await readSession(houseId, sessionId))!.notifiedAt).toBeDefined();
  });

  it("refuses a stranger", async () => {
    const { houseId, washerId } = await setupHouse();
    await seedFinished(houseId, washerId);
    await expectLaundryError(
      notifyCycleFinished(stranger(), { houseId, machineId: washerId }),
      "not a member",
    );
  });
});
