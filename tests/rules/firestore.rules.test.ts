import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  type Firestore,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-laundry";
const ADMIN = "admin-uid";
const MEMBER = "member-uid";
const OTHER = "other-uid"; // a second member of the same house
const STRANGER = "stranger-uid"; // signed in, not in the house
const HOUSE = "house-1";
const CODE = "ABC234";
const MACHINE = "washer";
const GRID_MS = 15 * 60_000;

/** Snaps epoch ms onto the 15-minute grid the booking rules insist on. */
const grid = (ms: number) => Math.floor(ms / GRID_MS) * GRID_MS;

let testEnv: RulesTestEnvironment;

const dbAs = (uid: string | null): Firestore =>
  (uid
    ? testEnv.authenticatedContext(uid)
    : testEnv.unauthenticatedContext()
  ).firestore() as unknown as Firestore;

const housePath = `houses/${HOUSE}`;
const machinePath = `${housePath}/machines/${MACHINE}`;

function memberData(role: "admin" | "member", group = "Upstairs") {
  return {
    displayName: "Someone",
    email: "x@example.com",
    group,
    role,
    joinedAt: serverTimestamp(),
  };
}

function freeMachine() {
  return { name: "Washer", type: "washer", status: "free", currentSession: null };
}

function runningMachine(uid: string, expectedEndMs: number) {
  return {
    name: "Washer",
    type: "washer",
    status: "in_use",
    currentSession: {
      sessionId: "s1",
      uid,
      displayName: "Someone",
      startedAt: Timestamp.fromMillis(expectedEndMs - 60 * 60_000),
      expectedEndAt: Timestamp.fromMillis(expectedEndMs),
    },
  };
}

/** A house with an admin, two members and a free washer, written with rules off. */
async function seedHouse() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, housePath), {
      name: "Test house",
      inviteCode: CODE,
      adminUid: ADMIN,
      groups: ["Upstairs", "Downstairs"],
      schedule: {
        mon: "Upstairs",
        tue: null,
        wed: null,
        thu: null,
        fri: null,
        sat: null,
        sun: null,
      },
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, `inviteCodes/${CODE}`), {
      houseId: HOUSE,
      houseName: "Test house",
      groups: ["Upstairs", "Downstairs"],
    });
    await setDoc(doc(db, `${housePath}/members/${ADMIN}`), memberData("admin"));
    await setDoc(doc(db, `${housePath}/members/${MEMBER}`), memberData("member"));
    await setDoc(
      doc(db, `${housePath}/members/${OTHER}`),
      memberData("member", "Downstairs"),
    );
    await setDoc(doc(db, machinePath), freeMachine());
    await setDoc(doc(db, `${housePath}/sessions/s1`), {
      machineId: MACHINE,
      uid: MEMBER,
      displayName: "Someone",
      startedAt: Timestamp.now(),
      expectedEndAt: Timestamp.now(),
      endedAt: null,
    });
    // Older than the 7-day window, so any member may sweep it.
    await setDoc(doc(db, `${housePath}/sessions/s_old`), {
      machineId: MACHINE,
      uid: MEMBER,
      displayName: "Someone",
      startedAt: Timestamp.fromMillis(Date.now() - 8 * 24 * 3_600_000),
      expectedEndAt: Timestamp.fromMillis(Date.now() - 8 * 24 * 3_600_000 + 3_600_000),
      endedAt: Timestamp.fromMillis(Date.now() - 8 * 24 * 3_600_000 + 3_600_000),
    });
    await setDoc(doc(db, `${housePath}/bookings/b1`), {
      machineId: MACHINE,
      uid: MEMBER,
      displayName: "Someone",
      startAt: Timestamp.fromMillis(grid(Date.now() + 3_600_000)),
      endAt: Timestamp.fromMillis(grid(Date.now() + 7_200_000)),
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, `${housePath}/slots/${MACHINE}_1`), {
      bookingId: "b1",
      machineId: MACHINE,
      uid: MEMBER,
      displayName: "Someone",
      startAt: Timestamp.fromMillis(grid(Date.now() + 3_600_000)),
      endAt: Timestamp.fromMillis(grid(Date.now() + 7_200_000)),
      slotIndex: 0,
    });
    // A booking (and slot) whose time has passed; anyone may sweep these.
    await setDoc(doc(db, `${housePath}/bookings/b_past`), {
      machineId: MACHINE,
      uid: MEMBER,
      displayName: "Someone",
      startAt: Timestamp.fromMillis(grid(Date.now() - 7_200_000)),
      endAt: Timestamp.fromMillis(grid(Date.now() - 3_600_000)),
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, `${housePath}/slots/${MACHINE}_past`), {
      bookingId: "b_past",
      machineId: MACHINE,
      uid: MEMBER,
      displayName: "Someone",
      startAt: Timestamp.fromMillis(grid(Date.now() - 7_200_000)),
      endAt: Timestamp.fromMillis(grid(Date.now() - 3_600_000)),
      slotIndex: 0,
    });
    await setDoc(doc(db, `users/${MEMBER}`), {
      houseId: HOUSE,
      displayName: "Someone",
      email: "x@example.com",
    });
  });
}

/** The same object without one key, for "missing required field" cases. */
function without<T extends Record<string, unknown>>(data: T, key: keyof T) {
  const copy = { ...data };
  delete copy[key];
  return copy;
}

/** Turns the house into one that vets newcomers, the way setJoinApproval does. */
async function setApprovalRequired(required: boolean) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await updateDoc(doc(db, housePath), { requireApproval: required });
    await updateDoc(doc(db, `inviteCodes/${CODE}`), { requireApproval: required });
  });
}

function joinRequestData(uid: string, status = "pending", group = "Upstairs") {
  return {
    uid,
    displayName: "Someone new",
    email: "new@example.com",
    group,
    status,
    requestedAt: serverTimestamp(),
    decidedAt: null,
  };
}

async function seedJoinRequest(uid: string, status = "pending") {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(
      doc(db, `${housePath}/joinRequests/${uid}`),
      joinRequestData(uid, status),
    );
  });
}

/** A membership somebody would write for themselves while joining. */
function selfMembership(group = "Upstairs") {
  return {
    displayName: "Sky",
    email: "sky@example.com",
    group,
    role: "member",
    joinedAt: serverTimestamp(),
  };
}

async function setMachine(data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, machinePath), data);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedHouse();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("unauthenticated access", () => {
  const paths = [
    housePath,
    machinePath,
    `${housePath}/members/${MEMBER}`,
    `${housePath}/bookings/b1`,
    `${housePath}/sessions/s1`,
    `${housePath}/slots/${MACHINE}_1`,
    `inviteCodes/${CODE}`,
    `users/${MEMBER}`,
  ];

  for (const path of paths) {
    it(`cannot read ${path}`, async () => {
      await assertFails(getDoc(doc(dbAs(null), path)));
    });
  }

  it("cannot list machines", async () => {
    await assertFails(getDocs(collection(dbAs(null), `${housePath}/machines`)));
  });
});

describe("non-member access", () => {
  it("cannot read the house", async () => {
    await assertFails(getDoc(doc(dbAs(STRANGER), housePath)));
  });

  it("cannot read or list machines", async () => {
    await assertFails(getDoc(doc(dbAs(STRANGER), machinePath)));
    await assertFails(getDocs(collection(dbAs(STRANGER), `${housePath}/machines`)));
  });

  it("cannot read members, bookings, sessions or slots", async () => {
    await assertFails(getDoc(doc(dbAs(STRANGER), `${housePath}/members/${MEMBER}`)));
    await assertFails(getDocs(collection(dbAs(STRANGER), `${housePath}/bookings`)));
    await assertFails(getDocs(collection(dbAs(STRANGER), `${housePath}/sessions`)));
    await assertFails(getDocs(collection(dbAs(STRANGER), `${housePath}/slots`)));
  });
});

describe("invite codes", () => {
  it("can be fetched by exact code when signed in", async () => {
    await assertSucceeds(getDoc(doc(dbAs(STRANGER), `inviteCodes/${CODE}`)));
  });

  it("cannot be listed", async () => {
    await assertFails(getDocs(collection(dbAs(STRANGER), "inviteCodes")));
    await assertFails(getDocs(collection(dbAs(ADMIN), "inviteCodes")));
  });

  it("cannot be created for a house you do not admin", async () => {
    await assertFails(
      setDoc(doc(dbAs(MEMBER), "inviteCodes/NEWCDE"), {
        houseId: HOUSE,
        houseName: "x",
        groups: [],
      }),
    );
    await assertFails(
      setDoc(doc(dbAs(STRANGER), "inviteCodes/NEWCDE"), {
        houseId: HOUSE,
        houseName: "x",
        groups: [],
      }),
    );
  });

  it("can be rotated by the admin but not re-pointed at another house", async () => {
    const db = dbAs(ADMIN);
    await assertSucceeds(
      setDoc(doc(db, "inviteCodes/NEWCDE"), {
        houseId: HOUSE,
        houseName: "x",
        groups: [],
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, `inviteCodes/${CODE}`), { houseName: "Renamed" }),
    );
    await assertFails(
      updateDoc(doc(db, `inviteCodes/${CODE}`), { houseId: "someone-elses" }),
    );
    await assertSucceeds(deleteDoc(doc(db, `inviteCodes/${CODE}`)));
    await assertFails(deleteDoc(doc(dbAs(MEMBER), "inviteCodes/NEWCDE")));
  });
});

describe("creating a house", () => {
  function houseBatch(
    db: Firestore,
    creator: string,
    adminUid: string,
    houseId: string,
    code: string,
  ) {
    const batch = writeBatch(db);
    batch.set(doc(db, `houses/${houseId}`), {
      name: "New house",
      inviteCode: code,
      adminUid,
      groups: ["Upstairs", "Downstairs"],
      schedule: {
        mon: "Upstairs",
        tue: "Downstairs",
        wed: null,
        thu: null,
        fri: null,
        sat: null,
        sun: null,
      },
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, `inviteCodes/${code}`), {
      houseId,
      houseName: "New house",
      groups: ["Upstairs", "Downstairs"],
    });
    batch.set(doc(db, `houses/${houseId}/members/${creator}`), memberData("admin"));
    batch.set(doc(db, `users/${creator}`), {
      houseId,
      displayName: "Someone",
      email: "x@example.com",
    });
    batch.set(doc(collection(db, `houses/${houseId}/machines`)), freeMachine());
    batch.set(doc(collection(db, `houses/${houseId}/machines`)), {
      ...freeMachine(),
      name: "Dryer",
      type: "dryer",
    });
    return batch;
  }

  it("succeeds as one batch for the creator", async () => {
    await assertSucceeds(
      houseBatch(dbAs(STRANGER), STRANGER, STRANGER, "house-2", "NEWCDE").commit(),
    );
  });

  it("fails when adminUid is somebody else", async () => {
    await assertFails(
      houseBatch(dbAs(STRANGER), STRANGER, OTHER, "house-2", "NEWCDE").commit(),
    );
    await assertFails(
      setDoc(doc(dbAs(STRANGER), "houses/house-3"), {
        name: "x",
        inviteCode: "Q",
        adminUid: OTHER,
        groups: [],
        schedule: {},
      }),
    );
  });

  it("fails when the invite code points at a house you do not admin", async () => {
    const db = dbAs(STRANGER);
    const batch = writeBatch(db);
    batch.set(doc(db, "houses/house-2"), {
      name: "x",
      inviteCode: "NEWCDE",
      adminUid: STRANGER,
      groups: [],
      schedule: {},
    });
    batch.set(doc(db, "inviteCodes/NEWCDE"), {
      houseId: HOUSE,
      houseName: "x",
      groups: [],
    });
    await assertFails(batch.commit());
  });

  it("fails when the invite code is already taken", async () => {
    await assertFails(
      houseBatch(dbAs(STRANGER), STRANGER, STRANGER, "house-2", CODE).commit(),
    );
  });
});

describe("members", () => {
  it("lets a signed-in user create their own member doc with role member", async () => {
    await assertSucceeds(
      setDoc(
        doc(dbAs(STRANGER), `${housePath}/members/${STRANGER}`),
        memberData("member"),
      ),
    );
  });

  it("does not let a user join with a group the house does not have", async () => {
    await assertFails(
      setDoc(
        doc(dbAs(STRANGER), `${housePath}/members/${STRANGER}`),
        memberData("member", "Attic"),
      ),
    );
  });

  it("does not let anyone move a member to a group the house does not have", async () => {
    await assertFails(
      updateDoc(doc(dbAs(ADMIN), `${housePath}/members/${MEMBER}`), { group: "Attic" }),
    );
    await assertFails(
      updateDoc(doc(dbAs(MEMBER), `${housePath}/members/${MEMBER}`), { group: "Attic" }),
    );
    await assertSucceeds(
      updateDoc(doc(dbAs(ADMIN), `${housePath}/members/${MEMBER}`), {
        group: "Downstairs",
      }),
    );
  });

  it("does not let a user join as admin", async () => {
    await assertFails(
      setDoc(
        doc(dbAs(STRANGER), `${housePath}/members/${STRANGER}`),
        memberData("admin"),
      ),
    );
  });

  it("does not let a user create a member doc for someone else", async () => {
    await assertFails(
      setDoc(
        doc(dbAs(STRANGER), `${housePath}/members/another-uid`),
        memberData("member"),
      ),
    );
    await assertFails(
      setDoc(doc(dbAs(ADMIN), `${housePath}/members/another-uid`), memberData("member")),
    );
  });

  it("does not let a member change their own role", async () => {
    await assertFails(
      updateDoc(doc(dbAs(MEMBER), `${housePath}/members/${MEMBER}`), { role: "admin" }),
    );
  });

  it("lets a member change their own group and name", async () => {
    await assertSucceeds(
      updateDoc(doc(dbAs(MEMBER), `${housePath}/members/${MEMBER}`), {
        group: "Downstairs",
        displayName: "New",
      }),
    );
  });

  it("lets the admin regroup another member but not promote them", async () => {
    await assertSucceeds(
      updateDoc(doc(dbAs(ADMIN), `${housePath}/members/${MEMBER}`), {
        group: "Downstairs",
      }),
    );
    await assertFails(
      updateDoc(doc(dbAs(ADMIN), `${housePath}/members/${MEMBER}`), { role: "admin" }),
    );
  });

  it("does not let a member edit another member", async () => {
    await assertFails(
      updateDoc(doc(dbAs(MEMBER), `${housePath}/members/${OTHER}`), {
        group: "Upstairs",
      }),
    );
  });

  it("lets the admin delete a normal member but not the admin", async () => {
    await assertSucceeds(deleteDoc(doc(dbAs(ADMIN), `${housePath}/members/${MEMBER}`)));
    await assertFails(deleteDoc(doc(dbAs(ADMIN), `${housePath}/members/${ADMIN}`)));
  });

  it("lets a member delete themselves but not others", async () => {
    await assertFails(deleteDoc(doc(dbAs(MEMBER), `${housePath}/members/${OTHER}`)));
    await assertSucceeds(deleteDoc(doc(dbAs(MEMBER), `${housePath}/members/${MEMBER}`)));
  });

  it("lets members read the member list", async () => {
    await assertSucceeds(
      getDocs(query(collection(dbAs(MEMBER), `${housePath}/members`), limit(200))),
    );
  });
});

describe("machines", () => {
  const future = () => Date.now() + 30 * 60_000;
  const past = () => Date.now() - 30 * 60_000;

  it("lets a member claim a free machine for themselves", async () => {
    await assertSucceeds(
      updateDoc(doc(dbAs(MEMBER), machinePath), {
        status: "in_use",
        currentSession: runningMachine(MEMBER, future()).currentSession,
      }),
    );
  });

  it("validates the session it is claimed with", async () => {
    const claim = (session: Record<string, unknown>) =>
      updateDoc(doc(dbAs(MEMBER), machinePath), {
        status: "in_use",
        currentSession: session,
      });
    const now = Date.now();
    const base = {
      sessionId: "s1",
      uid: MEMBER,
      displayName: "Someone",
      startedAt: Timestamp.fromMillis(now),
      expectedEndAt: Timestamp.fromMillis(now + 90 * 60_000),
    };

    await assertFails(claim({ ...base, expectedEndAt: Timestamp.fromMillis(now) }));
    await assertFails(claim({ ...base, expectedEndAt: Timestamp.fromMillis(now - 1) }));
    await assertFails(
      claim({ ...base, expectedEndAt: Timestamp.fromMillis(now + 11 * 3_600_000) }),
    );
    await assertFails(claim({ ...base, startedAt: "now" }));
    await assertFails(claim({ ...base, sessionId: 42 }));
    await assertFails(claim(without(base, "sessionId")));
    await assertFails(claim({ ...base, expectedEndAt: now + 60_000 }));
    await assertSucceeds(claim(base));
  });

  it("does not let a member claim a machine for someone else", async () => {
    await assertFails(
      updateDoc(doc(dbAs(MEMBER), machinePath), {
        status: "in_use",
        currentSession: runningMachine(OTHER, future()).currentSession,
      }),
    );
  });

  it("does not let a member claim a machine that is already in use", async () => {
    await setMachine(runningMachine(OTHER, future()));
    await assertFails(
      updateDoc(doc(dbAs(MEMBER), machinePath), {
        status: "in_use",
        currentSession: runningMachine(MEMBER, future()).currentSession,
      }),
    );
  });

  it("does not let a member rename a machine while claiming it", async () => {
    await assertFails(
      updateDoc(doc(dbAs(MEMBER), machinePath), {
        name: "Mine now",
        status: "in_use",
        currentSession: runningMachine(MEMBER, future()).currentSession,
      }),
    );
  });

  it("lets the session owner free the machine at any time", async () => {
    await setMachine(runningMachine(MEMBER, future()));
    await assertSucceeds(
      updateDoc(doc(dbAs(MEMBER), machinePath), { status: "free", currentSession: null }),
    );
  });

  it("does not let another member free it before the cycle finishes", async () => {
    await setMachine(runningMachine(MEMBER, future()));
    await assertFails(
      updateDoc(doc(dbAs(OTHER), machinePath), { status: "free", currentSession: null }),
    );
  });

  it("lets another member free it once the cycle has finished", async () => {
    await setMachine(runningMachine(MEMBER, past()));
    await assertSucceeds(
      updateDoc(doc(dbAs(OTHER), machinePath), { status: "free", currentSession: null }),
    );
  });

  it("lets the admin free it any time", async () => {
    await setMachine(runningMachine(MEMBER, future()));
    await assertSucceeds(
      updateDoc(doc(dbAs(ADMIN), machinePath), { status: "free", currentSession: null }),
    );
  });

  it("does not let a stranger touch it", async () => {
    await assertFails(
      updateDoc(doc(dbAs(STRANGER), machinePath), {
        status: "in_use",
        currentSession: runningMachine(STRANGER, future()).currentSession,
      }),
    );
  });

  it("lets only the admin rename, add and remove machines", async () => {
    await assertFails(updateDoc(doc(dbAs(MEMBER), machinePath), { name: "Renamed" }));
    await assertSucceeds(updateDoc(doc(dbAs(ADMIN), machinePath), { name: "Renamed" }));
    await assertFails(
      setDoc(doc(dbAs(MEMBER), `${housePath}/machines/dryer`), freeMachine()),
    );
    await assertSucceeds(
      setDoc(doc(dbAs(ADMIN), `${housePath}/machines/dryer`), freeMachine()),
    );
    await assertFails(deleteDoc(doc(dbAs(MEMBER), `${housePath}/machines/dryer`)));
    await assertSucceeds(deleteDoc(doc(dbAs(ADMIN), `${housePath}/machines/dryer`)));
  });

  it("lets members read machines", async () => {
    await assertSucceeds(
      getDocs(query(collection(dbAs(MEMBER), `${housePath}/machines`), limit(200))),
    );
  });
});

describe("sessions (the 7-day laundry log)", () => {
  const session = (uid: string, extra: Record<string, unknown> = {}) => ({
    machineId: MACHINE,
    uid,
    displayName: "Someone",
    startedAt: Timestamp.now(),
    expectedEndAt: Timestamp.now(),
    endedAt: null,
    ...extra,
  });

  it("lets members read one and list a bounded page", async () => {
    await assertSucceeds(getDoc(doc(dbAs(MEMBER), `${housePath}/sessions/s1`)));
    await assertSucceeds(
      getDocs(query(collection(dbAs(MEMBER), `${housePath}/sessions`), limit(200))),
    );
  });

  it("refuses an unbounded or oversized list", async () => {
    await assertFails(getDocs(collection(dbAs(MEMBER), `${housePath}/sessions`)));
    await assertFails(
      getDocs(query(collection(dbAs(MEMBER), `${housePath}/sessions`), limit(201))),
    );
  });

  it("lets a member log their own cycle only", async () => {
    await assertSucceeds(
      setDoc(doc(dbAs(MEMBER), `${housePath}/sessions/s2`), session(MEMBER)),
    );
    await assertFails(
      setDoc(doc(dbAs(MEMBER), `${housePath}/sessions/s3`), session(OTHER)),
    );
  });

  it("requires the machine and start time on create", async () => {
    await assertFails(
      setDoc(
        doc(dbAs(MEMBER), `${housePath}/sessions/s4`),
        without(session(MEMBER), "machineId"),
      ),
    );
    await assertFails(
      setDoc(
        doc(dbAs(MEMBER), `${housePath}/sessions/s5`),
        without(session(MEMBER), "startedAt"),
      ),
    );
    await assertFails(
      setDoc(
        doc(dbAs(MEMBER), `${housePath}/sessions/s6`),
        session(MEMBER, { startedAt: "now" }),
      ),
    );
  });

  it("lets anyone in the house close a cycle, but change nothing else", async () => {
    await assertSucceeds(
      updateDoc(doc(dbAs(OTHER), `${housePath}/sessions/s1`), {
        endedAt: Timestamp.now(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(dbAs(MEMBER), `${housePath}/sessions/s1`), {
        reminderId: "re_123",
      }),
    );
    await assertFails(
      updateDoc(doc(dbAs(MEMBER), `${housePath}/sessions/s1`), { displayName: "Nope" }),
    );
    // notifiedAt belonged to push notifications, which the app no longer has. The rule
    // lists its allowed fields, so a write naming it is refused rather than ignored.
    await assertFails(
      updateDoc(doc(dbAs(MEMBER), `${housePath}/sessions/s1`), {
        notifiedAt: Timestamp.now(),
      }),
    );
    await assertFails(
      updateDoc(doc(dbAs(MEMBER), `${housePath}/sessions/s1`), {
        endedAt: Timestamp.now(),
        notifiedAt: Timestamp.now(),
      }),
    );
    await assertFails(
      updateDoc(doc(dbAs(STRANGER), `${housePath}/sessions/s1`), {
        endedAt: Timestamp.now(),
      }),
    );
  });

  it("only sweeps entries older than the retention window", async () => {
    await assertFails(deleteDoc(doc(dbAs(MEMBER), `${housePath}/sessions/s1`)));
    await assertSucceeds(deleteDoc(doc(dbAs(MEMBER), `${housePath}/sessions/s_old`)));
  });

  it("lets the admin delete any entry", async () => {
    await assertSucceeds(deleteDoc(doc(dbAs(ADMIN), `${housePath}/sessions/s1`)));
  });
});

describe("bookings", () => {
  const start = Timestamp.fromMillis(grid(Date.now() + 3_600_000));
  const end = Timestamp.fromMillis(grid(Date.now() + 7_200_000));
  const booking = (uid: string, s = start, e = end) => ({
    machineId: MACHINE,
    uid,
    displayName: "Someone",
    startAt: s,
    endAt: e,
    createdAt: serverTimestamp(),
  });

  it("lets a member book for themselves with a valid range", async () => {
    await assertSucceeds(
      setDoc(doc(dbAs(MEMBER), `${housePath}/bookings/b2`), booking(MEMBER)),
    );
  });

  it("rejects an end before or equal to the start", async () => {
    await assertFails(
      setDoc(doc(dbAs(MEMBER), `${housePath}/bookings/b2`), booking(MEMBER, end, start)),
    );
    await assertFails(
      setDoc(
        doc(dbAs(MEMBER), `${housePath}/bookings/b2`),
        booking(MEMBER, start, start),
      ),
    );
  });

  it("insists on the 15-minute grid", async () => {
    const offGrid = Timestamp.fromMillis(start.toMillis() + 7 * 60_000);
    await assertFails(
      setDoc(
        doc(dbAs(MEMBER), `${housePath}/bookings/b2`),
        booking(MEMBER, offGrid, end),
      ),
    );
    await assertFails(
      setDoc(
        doc(dbAs(MEMBER), `${housePath}/bookings/b2`),
        booking(MEMBER, start, Timestamp.fromMillis(end.toMillis() + 60_000)),
      ),
    );
  });

  it("caps a booking at six hours", async () => {
    const sixH = Timestamp.fromMillis(start.toMillis() + 6 * 3_600_000);
    const sixH15 = Timestamp.fromMillis(start.toMillis() + 6 * 3_600_000 + GRID_MS);
    await assertFails(
      setDoc(
        doc(dbAs(MEMBER), `${housePath}/bookings/b2`),
        booking(MEMBER, start, sixH15),
      ),
    );
    await assertSucceeds(
      setDoc(doc(dbAs(MEMBER), `${housePath}/bookings/b3`), booking(MEMBER, start, sixH)),
    );
  });

  it("rejects a booking that is entirely in the past", async () => {
    const pastStart = Timestamp.fromMillis(grid(Date.now() - 3 * 3_600_000));
    const pastEnd = Timestamp.fromMillis(grid(Date.now() - 2 * 3_600_000));
    await assertFails(
      setDoc(
        doc(dbAs(MEMBER), `${housePath}/bookings/b2`),
        booking(MEMBER, pastStart, pastEnd),
      ),
    );
  });

  it("accepts 10:00–11:00 tomorrow", async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const ten = Timestamp.fromDate(tomorrow);
    const eleven = Timestamp.fromMillis(ten.toMillis() + 3_600_000);
    await assertSucceeds(
      setDoc(doc(dbAs(MEMBER), `${housePath}/bookings/b2`), booking(MEMBER, ten, eleven)),
    );
  });

  it("rejects booking on behalf of someone else", async () => {
    await assertFails(
      setDoc(doc(dbAs(MEMBER), `${housePath}/bookings/b2`), booking(OTHER)),
    );
  });

  it("rejects a stranger", async () => {
    await assertFails(
      setDoc(doc(dbAs(STRANGER), `${housePath}/bookings/b2`), booking(STRANGER)),
    );
  });

  it("never allows updates, even by the owner or admin", async () => {
    await assertFails(
      updateDoc(doc(dbAs(MEMBER), `${housePath}/bookings/b1`), { endAt: end }),
    );
    await assertFails(
      updateDoc(doc(dbAs(ADMIN), `${housePath}/bookings/b1`), { endAt: end }),
    );
  });

  it("lets any member sweep a booking whose time has passed", async () => {
    await assertSucceeds(deleteDoc(doc(dbAs(OTHER), `${housePath}/bookings/b_past`)));
  });

  it("does not let another member delete a booking that is still upcoming", async () => {
    await assertFails(deleteDoc(doc(dbAs(OTHER), `${housePath}/bookings/b1`)));
  });

  it("lets the owner and the admin cancel, but not another member", async () => {
    await assertFails(deleteDoc(doc(dbAs(OTHER), `${housePath}/bookings/b1`)));
    await assertSucceeds(deleteDoc(doc(dbAs(ADMIN), `${housePath}/bookings/b1`)));
    await setDoc(doc(dbAs(MEMBER), `${housePath}/bookings/b2`), booking(MEMBER));
    await assertSucceeds(deleteDoc(doc(dbAs(MEMBER), `${housePath}/bookings/b2`)));
  });

  it("lets members read bookings", async () => {
    await assertSucceeds(
      getDocs(query(collection(dbAs(OTHER), `${housePath}/bookings`), limit(200))),
    );
  });
});

describe("slots", () => {
  const slot = (uid: string) => ({
    bookingId: "b2",
    machineId: MACHINE,
    uid,
    displayName: "Someone",
    startAt: Timestamp.fromMillis(grid(Date.now() + 3_600_000)),
    endAt: Timestamp.fromMillis(grid(Date.now() + 7_200_000)),
    slotIndex: 0,
  });

  it("lets a member create a slot for themselves only", async () => {
    await assertSucceeds(
      setDoc(doc(dbAs(MEMBER), `${housePath}/slots/${MACHINE}_2`), slot(MEMBER)),
    );
    await assertFails(
      setDoc(doc(dbAs(MEMBER), `${housePath}/slots/${MACHINE}_3`), slot(OTHER)),
    );
    await assertFails(
      setDoc(doc(dbAs(STRANGER), `${housePath}/slots/${MACHINE}_4`), slot(STRANGER)),
    );
  });

  it("insists on bookingId and machineId strings", async () => {
    const { bookingId: _dropped, ...withoutBookingId } = slot(MEMBER);
    void _dropped;
    await assertFails(
      setDoc(doc(dbAs(MEMBER), `${housePath}/slots/${MACHINE}_5`), withoutBookingId),
    );
    await assertFails(
      setDoc(doc(dbAs(MEMBER), `${housePath}/slots/${MACHINE}_6`), {
        ...slot(MEMBER),
        machineId: 7,
      }),
    );
  });

  it("insists on an endAt timestamp", async () => {
    const { endAt: _dropped, ...withoutEndAt } = slot(MEMBER);
    void _dropped;
    await assertFails(
      setDoc(doc(dbAs(MEMBER), `${housePath}/slots/${MACHINE}_7`), withoutEndAt),
    );
    await assertFails(
      setDoc(doc(dbAs(MEMBER), `${housePath}/slots/${MACHINE}_8`), {
        ...slot(MEMBER),
        endAt: "later",
      }),
    );
  });

  it("lets any member sweep a slot whose time has passed, but not an upcoming one", async () => {
    await assertSucceeds(
      deleteDoc(doc(dbAs(OTHER), `${housePath}/slots/${MACHINE}_past`)),
    );
    await assertFails(deleteDoc(doc(dbAs(OTHER), `${housePath}/slots/${MACHINE}_1`)));
  });

  it("never lets an existing slot be overwritten, even by its owner", async () => {
    await assertFails(
      setDoc(doc(dbAs(MEMBER), `${housePath}/slots/${MACHINE}_1`), slot(MEMBER)),
    );
    await assertFails(
      setDoc(doc(dbAs(OTHER), `${housePath}/slots/${MACHINE}_1`), slot(OTHER)),
    );
    await assertFails(
      updateDoc(doc(dbAs(ADMIN), `${housePath}/slots/${MACHINE}_1`), { slotIndex: 9 }),
    );
  });

  it("lets the owner and admin delete a slot, but not another member", async () => {
    await assertFails(deleteDoc(doc(dbAs(OTHER), `${housePath}/slots/${MACHINE}_1`)));
    await assertSucceeds(deleteDoc(doc(dbAs(ADMIN), `${housePath}/slots/${MACHINE}_1`)));
    await setDoc(doc(dbAs(MEMBER), `${housePath}/slots/${MACHINE}_2`), slot(MEMBER));
    await assertSucceeds(deleteDoc(doc(dbAs(MEMBER), `${housePath}/slots/${MACHINE}_2`)));
  });

  it("lets members read slots (needed inside the booking transaction)", async () => {
    await assertSucceeds(getDoc(doc(dbAs(MEMBER), `${housePath}/slots/${MACHINE}_1`)));
  });

  it("accepts a full booking transaction of 24 slots plus the booking in one batch", async () => {
    const db = dbAs(OTHER);
    const batch = writeBatch(db);
    batch.set(doc(db, `${housePath}/bookings/b9`), {
      machineId: MACHINE,
      uid: OTHER,
      displayName: "Someone",
      startAt: Timestamp.fromMillis(grid(Date.now() + 3_600_000)),
      endAt: Timestamp.fromMillis(grid(Date.now() + 3_600_000) + 6 * 3_600_000),
      createdAt: serverTimestamp(),
    });
    for (let i = 100; i < 124; i++)
      batch.set(doc(db, `${housePath}/slots/${MACHINE}_${i}`), slot(OTHER));
    await assertSucceeds(batch.commit());
  });
});

describe("house document", () => {
  it("lets the admin update name, groups and schedule", async () => {
    await assertSucceeds(
      updateDoc(doc(dbAs(ADMIN), housePath), {
        name: "Renamed",
        groups: ["A", "B"],
        schedule: {
          mon: "A",
          tue: "B",
          wed: null,
          thu: null,
          fri: null,
          sat: null,
          sun: null,
        },
      }),
    );
  });

  it("insists groups stay a non-empty list", async () => {
    await assertFails(updateDoc(doc(dbAs(ADMIN), housePath), { groups: [] }));
    await assertFails(updateDoc(doc(dbAs(ADMIN), housePath), { groups: "Upstairs" }));
    await assertSucceeds(
      updateDoc(doc(dbAs(ADMIN), housePath), { groups: ["Upstairs"] }),
    );
  });

  it("does not let the admin hand over adminUid", async () => {
    await assertFails(updateDoc(doc(dbAs(ADMIN), housePath), { adminUid: MEMBER }));
  });

  it("does not let a member update the house", async () => {
    await assertFails(updateDoc(doc(dbAs(MEMBER), housePath), { name: "Renamed" }));
  });

  it("lets nobody delete the house", async () => {
    await assertFails(deleteDoc(doc(dbAs(ADMIN), housePath)));
  });

  it("lets members read the house", async () => {
    await assertSucceeds(getDoc(doc(dbAs(MEMBER), housePath)));
  });
});

describe("users", () => {
  it("lets a user read and write their own doc only", async () => {
    await assertSucceeds(getDoc(doc(dbAs(MEMBER), `users/${MEMBER}`)));
    await assertSucceeds(
      setDoc(doc(dbAs(MEMBER), `users/${MEMBER}`), { houseId: null }, { merge: true }),
    );
    await assertFails(getDoc(doc(dbAs(OTHER), `users/${MEMBER}`)));
    await assertFails(
      setDoc(doc(dbAs(OTHER), `users/${MEMBER}`), { houseId: null }, { merge: true }),
    );
    await assertFails(getDoc(doc(dbAs(ADMIN), `users/${MEMBER}`)));
  });
});

describe("joinRequests", () => {
  it("is closed to people outside the house", async () => {
    await seedJoinRequest(STRANGER);
    await assertFails(getDoc(doc(dbAs(null), `${housePath}/joinRequests/${STRANGER}`)));
    await assertFails(
      setDoc(
        doc(dbAs(null), `${housePath}/joinRequests/nobody`),
        joinRequestData("nobody"),
      ),
    );
  });

  it("lets the requester read their own but not somebody else's", async () => {
    await seedJoinRequest(STRANGER);
    await seedJoinRequest("second-uid");

    await assertSucceeds(
      getDoc(doc(dbAs(STRANGER), `${housePath}/joinRequests/${STRANGER}`)),
    );
    await assertFails(
      getDoc(doc(dbAs(STRANGER), `${housePath}/joinRequests/second-uid`)),
    );
  });

  it("lets the admin read any request, but only the admin may list them", async () => {
    await seedJoinRequest(STRANGER);

    await assertSucceeds(
      getDoc(doc(dbAs(ADMIN), `${housePath}/joinRequests/${STRANGER}`)),
    );
    await assertSucceeds(
      getDocs(query(collection(dbAs(ADMIN), `${housePath}/joinRequests`), limit(50))),
    );
    await assertFails(
      getDocs(query(collection(dbAs(MEMBER), `${housePath}/joinRequests`), limit(50))),
    );
    await assertFails(
      getDocs(query(collection(dbAs(STRANGER), `${housePath}/joinRequests`), limit(50))),
    );
  });

  it("only lets you file a request in your own name", async () => {
    await assertSucceeds(
      setDoc(
        doc(dbAs(STRANGER), `${housePath}/joinRequests/${STRANGER}`),
        joinRequestData(STRANGER),
      ),
    );
    await assertFails(
      setDoc(
        doc(dbAs(STRANGER), `${housePath}/joinRequests/someone-else`),
        joinRequestData("someone-else"),
      ),
    );
  });

  it("refuses a request that arrives already approved, or with an unknown group", async () => {
    await assertFails(
      setDoc(
        doc(dbAs(STRANGER), `${housePath}/joinRequests/${STRANGER}`),
        joinRequestData(STRANGER, "approved"),
      ),
    );
    await assertFails(
      setDoc(
        doc(dbAs(STRANGER), `${housePath}/joinRequests/${STRANGER}`),
        joinRequestData(STRANGER, "pending", "Attic"),
      ),
    );
    await assertFails(
      setDoc(
        doc(dbAs(STRANGER), `${housePath}/joinRequests/${STRANGER}`),
        without(joinRequestData(STRANGER), "displayName"),
      ),
    );
  });

  it("lets the requester retry, but never approve themselves", async () => {
    await seedJoinRequest(STRANGER);

    await assertSucceeds(
      setDoc(
        doc(dbAs(STRANGER), `${housePath}/joinRequests/${STRANGER}`),
        joinRequestData(STRANGER, "pending", "Downstairs"),
      ),
    );
    await assertFails(
      updateDoc(doc(dbAs(STRANGER), `${housePath}/joinRequests/${STRANGER}`), {
        status: "approved",
      }),
    );
  });

  it("lets the admin decide, and only decide", async () => {
    await seedJoinRequest(STRANGER);

    await assertSucceeds(
      updateDoc(doc(dbAs(ADMIN), `${housePath}/joinRequests/${STRANGER}`), {
        status: "approved",
        decidedAt: Timestamp.now(),
      }),
    );
    await assertFails(
      updateDoc(doc(dbAs(ADMIN), `${housePath}/joinRequests/${STRANGER}`), {
        status: "declined",
        group: "Downstairs",
      }),
    );
    await assertFails(
      updateDoc(doc(dbAs(MEMBER), `${housePath}/joinRequests/${STRANGER}`), {
        status: "approved",
      }),
    );
  });

  it("lets the requester or the admin throw it away, nobody else", async () => {
    await seedJoinRequest(STRANGER);
    await assertFails(
      deleteDoc(doc(dbAs(MEMBER), `${housePath}/joinRequests/${STRANGER}`)),
    );
    await assertSucceeds(
      deleteDoc(doc(dbAs(STRANGER), `${housePath}/joinRequests/${STRANGER}`)),
    );

    await seedJoinRequest(STRANGER);
    await assertSucceeds(
      deleteDoc(doc(dbAs(ADMIN), `${housePath}/joinRequests/${STRANGER}`)),
    );
  });
});

describe("members create, when the house vets newcomers", () => {
  it("lets anyone with the houseId in while approval is off", async () => {
    // The seeded house has no requireApproval field at all, as older houses do not.
    await assertSucceeds(
      setDoc(doc(dbAs(STRANGER), `${housePath}/members/${STRANGER}`), selfMembership()),
    );
  });

  it("still lets them in when the flag is explicitly false", async () => {
    await setApprovalRequired(false);
    await assertSucceeds(
      setDoc(doc(dbAs(STRANGER), `${housePath}/members/${STRANGER}`), selfMembership()),
    );
  });

  it("refuses a self-made membership when approval is required", async () => {
    await setApprovalRequired(true);
    // A valid group and a known houseId are no longer enough on their own.
    await assertFails(
      setDoc(doc(dbAs(STRANGER), `${housePath}/members/${STRANGER}`), selfMembership()),
    );
  });

  it("still refuses while the request is only pending", async () => {
    await setApprovalRequired(true);
    await seedJoinRequest(STRANGER, "pending");
    await assertFails(
      setDoc(doc(dbAs(STRANGER), `${housePath}/members/${STRANGER}`), selfMembership()),
    );
  });

  it("refuses after a decline", async () => {
    await setApprovalRequired(true);
    await seedJoinRequest(STRANGER, "declined");
    await assertFails(
      setDoc(doc(dbAs(STRANGER), `${housePath}/members/${STRANGER}`), selfMembership()),
    );
  });

  it("lets them in once the admin has approved", async () => {
    await setApprovalRequired(true);
    await seedJoinRequest(STRANGER, "approved");
    await assertSucceeds(
      setDoc(doc(dbAs(STRANGER), `${housePath}/members/${STRANGER}`), selfMembership()),
    );
  });

  it("does not let an approved request excuse anything else", async () => {
    await setApprovalRequired(true);
    await seedJoinRequest(STRANGER, "approved");

    // An unknown group and somebody else's membership are still refused.
    await assertFails(
      setDoc(
        doc(dbAs(STRANGER), `${housePath}/members/${STRANGER}`),
        selfMembership("Attic"),
      ),
    );
    await assertFails(
      setDoc(doc(dbAs(STRANGER), `${housePath}/members/other-person`), selfMembership()),
    );
  });
});
