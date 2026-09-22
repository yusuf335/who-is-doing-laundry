import "server-only";

import { FirebaseError } from "firebase/app";
import {
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { fail } from "@/lib/errors";
import type { ServerContext } from "@/lib/firebase-server";
import { generateInviteCode, normaliseInviteCode } from "@/lib/invite";
import {
  bookingDoc,
  bookingsCol,
  houseDoc,
  housesCol,
  inviteCodeDoc,
  joinRequestDoc,
  machineDoc,
  machinesCol,
  memberDoc,
  membersCol,
  sessionDoc,
  sessionsCol,
  slotDoc,
  userDoc,
} from "@/lib/paths";
import { dayAccess, defaultSchedule } from "@/lib/schedule";
import { parseSender } from "@/lib/reminder";
import { cancelScheduledEmail, scheduleCycleReminder } from "@/server/resend";
import {
  MAX_BOOKING_MINUTES,
  SLOT_MINUTES,
  formatTime,
  isValidTimeZone,
  slotIdsForRange,
  snapToSlot,
} from "@/lib/time";
import type {
  Booking,
  House,
  InviteLookup,
  Machine,
  MachineType,
  JoinRequest,
  Member,
  Schedule,
  ScheduleMode,
} from "@/lib/types";
import {
  ABSOLUTE_MAX_MINUTES,
  DEFAULT_CYCLES,
  DEFAULT_MAX_MINUTES,
  MACHINE_TYPES,
  MAX_CYCLES_PER_MACHINE,
  SCHEDULE_MODES,
  SESSION_RETENTION_DAYS,
  WEEKDAYS,
  maxMinutesOf,
  type Cycle,
} from "@/lib/types";

// All of the house rules live here and run on the server as the signed-in user, so the
// browser never decides who may do what, and Firestore's security rules still get the
// final say on every write because the server app carries the user's own token.

/* ------------------------------------------------------------------ membership */

/** The rules deny reads to outsiders, which is how "not a member" first shows up. */
function isPermissionDenied(error: unknown): boolean {
  return error instanceof FirebaseError && error.code === "permission-denied";
}

interface Actor {
  houseId: string;
  house: House;
  member: Member;
  isAdmin: boolean;
}

/** Loads the caller's membership of `houseId`, or fails if they are not in that house. */
async function requireMember(ctx: ServerContext, houseId: string): Promise<Actor> {
  const [houseSnap, memberSnap] = await Promise.all([
    getDoc(houseDoc(ctx.db, houseId)),
    getDoc(memberDoc(ctx.db, houseId, ctx.user.uid)),
  ]).catch((error: unknown) => {
    if (isPermissionDenied(error)) fail("You're not a member of this house.");
    throw error;
  });
  if (!houseSnap.exists() || !memberSnap.exists()) {
    fail("You're not a member of this house.");
  }
  const house = { id: houseSnap.id, ...houseSnap.data() } as House;
  const member = { uid: memberSnap.id, ...memberSnap.data() } as Member;
  return { houseId, house, member, isAdmin: house.adminUid === member.uid };
}

async function requireAdmin(ctx: ServerContext, houseId: string): Promise<Actor> {
  const actor = await requireMember(ctx, houseId);
  if (!actor.isAdmin) fail("Only the house admin can do that.");
  return actor;
}

function cleanGroups(groups: string[]): string[] {
  const cleaned = groups.map((g) => g.trim()).filter(Boolean);
  if (cleaned.length === 0) fail("Keep at least one group.");
  if (new Set(cleaned).size !== cleaned.length) fail("Group names have to be unique.");
  return cleaned;
}

/* ------------------------------------------------------------------ onboarding */

export interface CreateHouseInput {
  houseName: string;
  displayName: string;
  groups: string[];
  group: string;
  /** IANA zone from the creator's device; decides where midnight is for the schedule. */
  timeZone?: string;
}

/**
 * Creates the house, its invite code, the first member (admin) and a washer/dryer in one
 * atomic batch, so a half-built house can never be left behind.
 */
export async function createHouse(ctx: ServerContext, input: CreateHouseInput) {
  const houseName = input.houseName.trim();
  const displayName = input.displayName.trim();
  const groups = cleanGroups(input.groups);
  if (!houseName) fail("Give the house a name.");
  if (!displayName) fail("Tell your housemates your name.");
  if (!groups.includes(input.group)) fail("Pick the group you belong to.");
  const timeZone =
    input.timeZone && isValidTimeZone(input.timeZone) ? input.timeZone : "UTC";

  const houseRef = doc(housesCol(ctx.db));
  const houseId = houseRef.id;

  // A collision just means the random code is taken; the rules reject overwriting it.
  for (let attempt = 0; attempt < 5; attempt++) {
    const inviteCode = generateInviteCode();
    const batch = writeBatch(ctx.db);

    batch.set(houseRef, {
      name: houseName,
      inviteCode,
      adminUid: ctx.user.uid,
      groups,
      schedule: defaultSchedule(groups),
      scheduleMode: "soft",
      timeZone,
      emailReminders: false,
      requireApproval: false,
      createdAt: serverTimestamp(),
    });
    batch.set(inviteCodeDoc(ctx.db, inviteCode), {
      houseId,
      houseName,
      groups,
      requireApproval: false,
    });
    batch.set(memberDoc(ctx.db, houseId, ctx.user.uid), {
      displayName,
      email: ctx.user.email ?? "",
      group: input.group,
      role: "admin",
      joinedAt: serverTimestamp(),
    });
    batch.set(userDoc(ctx.db, ctx.user.uid), {
      houseId,
      displayName,
      email: ctx.user.email ?? "",
    });
    batch.set(doc(machinesCol(ctx.db, houseId)), {
      name: "Washer",
      type: "washer",
      status: "free",
      currentSession: null,
      cycles: DEFAULT_CYCLES.washer,
      maxMinutes: DEFAULT_MAX_MINUTES.washer,
      order: 0,
    });
    batch.set(doc(machinesCol(ctx.db, houseId)), {
      name: "Dryer",
      type: "dryer",
      status: "free",
      currentSession: null,
      cycles: DEFAULT_CYCLES.dryer,
      maxMinutes: DEFAULT_MAX_MINUTES.dryer,
      order: 1,
    });

    try {
      await batch.commit();
      return { houseId };
    } catch (error) {
      const taken = await getDoc(inviteCodeDoc(ctx.db, inviteCode));
      if (!taken.exists()) throw error;
    }
  }
  return fail("Could not generate a free invite code. Please try again.");
}

export async function lookupInviteCode(
  ctx: ServerContext,
  rawCode: string,
): Promise<InviteLookup> {
  const code = normaliseInviteCode(rawCode);
  if (code.length < 4) fail("That invite code looks too short.");
  const snap = await getDoc(inviteCodeDoc(ctx.db, code));
  if (!snap.exists()) fail("No house found for that invite code.");
  return { code, ...(snap.data() as Omit<InviteLookup, "code">) };
}

export async function joinHouse(
  ctx: ServerContext,
  input: { code: string; displayName: string; group: string },
) {
  const invite = await lookupInviteCode(ctx, input.code);
  const displayName = input.displayName.trim();
  if (!displayName) fail("Tell your housemates your name.");
  if (!invite.groups.includes(input.group)) fail("Pick the group you belong to.");

  const existing = await getDoc(userDoc(ctx.db, ctx.user.uid));
  if (existing.data()?.houseId) fail("You're already in a house. Leave it first.");

  // Already a member, but the pointer to this house was lost: a reinstall that cleared the
  // browser, or a device that was offline at the wrong moment. Put the pointer back and
  // leave the membership exactly as it was, so an admin stays an admin. Rewriting the
  // member document here would try to demote them, and the rules would refuse.
  //
  // Reading a member document requires already being a member, so for a newcomer this read
  // is denied rather than empty. Both answers mean the same thing here: carry on and join.
  const current = await getDoc(memberDoc(ctx.db, invite.houseId, ctx.user.uid))
    .then((snap) => (snap.exists() ? snap : null))
    .catch((error: unknown) => {
      if (isPermissionDenied(error)) return null;
      throw error;
    });

  if (current) {
    const member = current.data() as Omit<Member, "uid">;
    await setDoc(userDoc(ctx.db, ctx.user.uid), {
      houseId: invite.houseId,
      displayName: member.displayName,
      email: member.email,
    });
    return {
      houseId: invite.houseId,
      houseName: invite.houseName,
      rejoined: true,
      pending: false,
    };
  }

  // Houses that vet newcomers: the code gets you a request, the admin decides. Calling
  // this again is how the app checks back, so every state answers for itself. The flag
  // is read from the invite document because a newcomer cannot read the house itself.
  const needsApproval = invite.requireApproval === true;

  if (needsApproval) {
    const requestRef = joinRequestDoc(ctx.db, invite.houseId, ctx.user.uid);
    const existing = await getDoc(requestRef);
    const request = existing.data() as JoinRequest | undefined;

    if (request?.status === "declined") {
      fail("Your request to join was turned down. Ask your housemates about it.");
    }

    if (request?.status !== "approved") {
      await setDoc(requestRef, {
        uid: ctx.user.uid,
        displayName,
        email: ctx.user.email ?? "",
        group: input.group,
        status: "pending",
        requestedAt: request?.requestedAt ?? serverTimestamp(),
        decidedAt: null,
      });
      return {
        houseId: invite.houseId,
        houseName: invite.houseName,
        rejoined: false,
        pending: true,
      };
    }
  }

  const batch = writeBatch(ctx.db);
  batch.set(memberDoc(ctx.db, invite.houseId, ctx.user.uid), {
    displayName,
    email: ctx.user.email ?? "",
    group: input.group,
    role: "member",
    joinedAt: serverTimestamp(),
  });
  batch.set(userDoc(ctx.db, ctx.user.uid), {
    houseId: invite.houseId,
    displayName,
    email: ctx.user.email ?? "",
  });
  // The request has done its job; the membership is the record now.
  if (needsApproval) batch.delete(joinRequestDoc(ctx.db, invite.houseId, ctx.user.uid));
  await batch.commit();
  return {
    houseId: invite.houseId,
    houseName: invite.houseName,
    rejoined: false,
    pending: false,
  };
}

/**
 * Leaves the house, taking everything of yours with you: the membership, and your
 * upcoming bookings with the slots they hold.
 *
 * The admin cannot leave, because the rules forbid deleting the admin's membership and a
 * house with no admin can never be administered again. Transferring the role first would
 * be the way to allow it, which the app does not do yet.
 */
export async function leaveHouse(ctx: ServerContext, input: { houseId: string }) {
  const { member, isAdmin } = await requireMember(ctx, input.houseId);
  if (isAdmin) {
    fail("The admin cannot leave the house. Ask a housemate to start a new one instead.");
  }

  // Walking out mid-cycle would leave a machine claimed by somebody who is gone.
  const machines = await getDocs(query(machinesCol(ctx.db, input.houseId), limit(50)));
  const running = machines.docs.find(
    (d) => (d.data() as Machine).currentSession?.uid === member.uid,
  );
  if (running) {
    fail(`Mark ${(running.data() as Machine).name} as emptied before you leave.`);
  }

  const bookings = await getDocs(
    query(bookingsCol(ctx.db, input.houseId), where("uid", "==", member.uid), limit(50)),
  );

  const batch = writeBatch(ctx.db);
  bookings.forEach((snap) => {
    const booking = snap.data() as Omit<Booking, "id">;
    batch.delete(snap.ref);
    for (const id of slotIdsForRange(
      booking.machineId,
      booking.startAt.toDate(),
      booking.endAt.toDate(),
    )) {
      batch.delete(slotDoc(ctx.db, input.houseId, id));
    }
  });
  batch.delete(memberDoc(ctx.db, input.houseId, member.uid));
  batch.set(userDoc(ctx.db, ctx.user.uid), { houseId: null }, { merge: true });
  await batch.commit();

  return { bookingsCancelled: bookings.size };
}

/** Clears a stale pointer left behind when an admin removed the member document. */
export async function clearHousePointer(ctx: ServerContext) {
  const pointer = await getDoc(userDoc(ctx.db, ctx.user.uid));
  const houseId = pointer.data()?.houseId as string | undefined;
  if (!houseId) return;
  // Once the admin has deleted our member document the rules no longer let us read it,
  // so a denied read means exactly the same thing as a missing document.
  const stillMember = await getDoc(memberDoc(ctx.db, houseId, ctx.user.uid))
    .then((snap) => snap.exists())
    .catch((error: unknown) => {
      if (isPermissionDenied(error)) return false;
      throw error;
    });
  if (stillMember) fail("You're still a member of that house.");
  await updateDoc(userDoc(ctx.db, ctx.user.uid), { houseId: null });
}

/* ------------------------------------------------------------------ machines */

export async function startSession(
  ctx: ServerContext,
  input: { houseId: string; machineId: string; minutes: number },
) {
  const { minutes } = input;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > ABSOLUTE_MAX_MINUTES) {
    fail(`Choose a cycle length between 1 and ${ABSOLUTE_MAX_MINUTES} minutes.`);
  }
  const { house, member } = await requireMember(ctx, input.houseId);
  const access = dayAccess(house, member, new Date());
  if (!access.allowed) fail(access.reason!);

  const machineRef = machineDoc(ctx.db, input.houseId, input.machineId);
  const sessionRef = doc(sessionsCol(ctx.db, input.houseId));

  // Fixed up front so the slot documents we check are exactly the ones this cycle covers.
  const startedAt = Timestamp.now();
  const expectedEndAt = Timestamp.fromMillis(startedAt.toMillis() + minutes * 60_000);

  // Bookings hold one document per 15-minute slot, so the mechanism that stops two
  // bookings overlapping also tells us whether this cycle would run into one.
  const windowSlotIds = slotIdsForRange(
    input.machineId,
    snapToSlot(startedAt.toDate()),
    expectedEndAt.toDate(),
  );

  const claimedBy = (machine: Omit<Machine, "id">) =>
    fail(
      `${machine.name} was just claimed by ${machine.currentSession?.displayName ?? "someone"}.`,
    );

  await runTransaction(ctx.db, async (tx) => {
    // All reads before any write, so the slot lookups join the machine read.
    const snap = await tx.get(machineRef);
    const slotSnaps = await Promise.all(
      windowSlotIds.map((id) => tx.get(slotDoc(ctx.db, input.houseId, id))),
    );

    if (!snap.exists()) fail("That machine no longer exists.");
    const machine = snap.data() as Omit<Machine, "id">;
    const longest = maxMinutesOf(machine);
    if (minutes > longest) {
      fail(`${machine.name} runs at most ${longest} minutes per cycle.`);
    }
    if (machine.status !== "free") claimedBy(machine);

    // Your own booking is yours to use; anyone else's is a reason to wait.
    const clash = slotSnaps.find(
      (slot) => slot.exists() && (slot.data() as { uid?: string }).uid !== member.uid,
    );
    if (clash) {
      const booking = clash.data() as { displayName?: string; endAt?: Timestamp };
      const until = booking.endAt ? ` until ${formatTime(booking.endAt.toDate())}` : "";
      fail(
        `${machine.name} is booked by ${booking.displayName ?? "someone"}${until}. Pick a shorter cycle or wait for their slot.`,
      );
    }

    tx.update(machineRef, {
      status: "in_use",
      currentSession: {
        sessionId: sessionRef.id,
        uid: member.uid,
        displayName: member.displayName,
        startedAt,
        expectedEndAt,
      },
    });

    // The log entry: who ran what, kept for a week so lost laundry can be claimed.
    tx.set(sessionRef, {
      machineId: input.machineId,
      uid: member.uid,
      displayName: member.displayName,
      startedAt,
      expectedEndAt,
      endedAt: null,
    });
  }).catch(async (error: unknown) => {
    // When two people press Start together, the loser's commit is refused by the rules
    // (the machine is no longer free) rather than retried, so look again to explain why.
    if (!isPermissionDenied(error)) throw error;
    const now = await getDoc(machineRef);
    if (now.exists() && now.data()?.status !== "free")
      claimedBy(now.data() as Omit<Machine, "id">);
    throw error;
  });

  // Two gates: the admin turns email on for the house, and each person opts in for
  // themselves. The notification is the default channel; email is for whoever wants it.
  if (house.emailReminders !== true || member.emailReminders !== true) return;

  // Only once the machine is ours: handing the reminder to Resend takes a network round
  // trip, and nothing about the claim should wait on it.
  const machineSnap = await getDoc(machineRef);
  const reminderId = await scheduleCycleReminder({
    to: member.email,
    displayName: member.displayName,
    machineName: (machineSnap.data() as Machine | undefined)?.name ?? "machine",
    houseName: house.name,
    finishesAt: expectedEndAt.toDate(),
    from: house.emailFrom,
  });
  if (reminderId) {
    await updateDoc(sessionRef, { reminderId }).catch((error: unknown) => {
      // Without the id the reminder cannot be called off early, which is a nuisance
      // rather than a reason to fail a cycle that has already started.
      console.error("store reminder id", error);
    });
  }
}

/**
 * Ends a running cycle. The owner and the admin can stop it at any time; anyone else has
 * to wait until the cycle has finished, which is the "I emptied it" case.
 */
export async function endSession(
  ctx: ServerContext,
  input: { houseId: string; machineId: string },
) {
  const { member, isAdmin } = await requireMember(ctx, input.houseId);
  const machineRef = machineDoc(ctx.db, input.houseId, input.machineId);
  let reminderToCancel: string | null = null;

  await runTransaction(ctx.db, async (tx) => {
    const snap = await tx.get(machineRef);
    if (!snap.exists()) fail("That machine no longer exists.");
    const machine = snap.data() as Omit<Machine, "id">;
    const session = machine.currentSession;
    if (machine.status === "free" || !session) return;

    const finished = session.expectedEndAt.toMillis() <= Date.now();
    if (session.uid !== member.uid && !isAdmin && !finished) {
      fail(`Only ${session.displayName} can stop this cycle before it finishes.`);
    }

    // Still a read, so it may precede the writes below.
    const logRef = session.sessionId
      ? sessionDoc(ctx.db, input.houseId, session.sessionId)
      : null;
    const logSnap = logRef ? await tx.get(logRef) : null;

    tx.update(machineRef, { status: "free", currentSession: null });
    // Close the log entry if it is still there; pruning may already have removed it.
    if (logRef && logSnap?.exists()) tx.update(logRef, { endedAt: Timestamp.now() });

    // Stopped early, so the "your wash is done" email is no longer true.
    if (session.expectedEndAt.toMillis() > Date.now()) {
      const pending = logSnap?.data()?.reminderId;
      if (typeof pending === "string") reminderToCancel = pending;
    }
  });

  if (reminderToCancel) await cancelScheduledEmail(reminderToCancel);
}

/* ------------------------------------------------------------------ bookings */

export async function createBooking(
  ctx: ServerContext,
  input: { houseId: string; machineId: string; startMs: number; endMs: number },
) {
  const { house, member } = await requireMember(ctx, input.houseId);
  const start = new Date(input.startMs);
  const end = new Date(input.endMs);
  const slotMs = SLOT_MINUTES * 60_000;
  const minutes = (input.endMs - input.startMs) / 60_000;

  if (!Number.isFinite(input.startMs) || !Number.isFinite(input.endMs)) {
    fail("Pick a start and end time.");
  }
  if (minutes <= 0) fail("The end time has to be after the start time.");
  if (input.startMs % slotMs !== 0 || input.endMs % slotMs !== 0) {
    fail(`Bookings run in ${SLOT_MINUTES}-minute steps.`);
  }
  if (minutes > MAX_BOOKING_MINUTES) {
    fail(`Bookings can be at most ${MAX_BOOKING_MINUTES / 60} hours long.`);
  }
  if (input.endMs <= Date.now()) fail("That slot is already in the past.");

  // The day the booking starts on decides; it may run past midnight.
  const access = dayAccess(house, member, start);
  if (!access.allowed) fail(access.reason!);

  const machine = await getDoc(machineDoc(ctx.db, input.houseId, input.machineId));
  if (!machine.exists()) fail("That machine no longer exists.");

  const slotIds = slotIdsForRange(input.machineId, start, end);
  const bookingRef = doc(bookingsCol(ctx.db, input.houseId));

  const overlaps = (clash: { displayName?: string; startAt?: Timestamp }) => {
    const who = clash.displayName ?? "someone";
    const when = clash.startAt ? ` at ${formatTime(clash.startAt.toDate())}` : "";
    fail(`That overlaps a booking by ${who}${when}.`);
  };

  await runTransaction(ctx.db, async (tx) => {
    // All reads must happen before any write inside a transaction.
    const slotSnaps = await Promise.all(
      slotIds.map((id) => tx.get(slotDoc(ctx.db, input.houseId, id))),
    );
    const clash = slotSnaps.find((snap) => snap.exists());
    if (clash) overlaps(clash.data() as { displayName?: string; startAt?: Timestamp });

    const startAt = Timestamp.fromDate(start);
    tx.set(bookingRef, {
      machineId: input.machineId,
      uid: member.uid,
      displayName: member.displayName,
      startAt,
      endAt: Timestamp.fromDate(end),
      createdAt: serverTimestamp(),
    });
    slotIds.forEach((id, slotIndex) => {
      tx.set(slotDoc(ctx.db, input.houseId, id), {
        bookingId: bookingRef.id,
        machineId: input.machineId,
        uid: member.uid,
        displayName: member.displayName,
        startAt,
        endAt: Timestamp.fromDate(end),
        slotIndex,
      });
    });
  }).catch(async (error: unknown) => {
    // Two people booking the same slot together: the loser is refused by the rules (a
    // slot can never be overwritten) instead of retried, so re-read to name the winner.
    if (!isPermissionDenied(error)) throw error;
    const snaps = await Promise.all(
      slotIds.map((id) => getDoc(slotDoc(ctx.db, input.houseId, id))),
    );
    const clash = snaps.find((snap) => snap.exists());
    if (clash) overlaps(clash.data() as { displayName?: string; startAt?: Timestamp });
    throw error;
  });

  return { bookingId: bookingRef.id };
}

export async function cancelBooking(
  ctx: ServerContext,
  input: { houseId: string; bookingId: string },
) {
  const { member, isAdmin } = await requireMember(ctx, input.houseId);
  const snap = await getDoc(bookingDoc(ctx.db, input.houseId, input.bookingId));
  if (!snap.exists()) return;
  const booking = snap.data() as Omit<Booking, "id">;
  if (booking.uid !== member.uid && !isAdmin) {
    fail("You can only cancel your own bookings.");
  }

  const batch = writeBatch(ctx.db);
  batch.delete(bookingDoc(ctx.db, input.houseId, input.bookingId));
  for (const id of slotIdsForRange(
    booking.machineId,
    booking.startAt.toDate(),
    booking.endAt.toDate(),
  )) {
    batch.delete(slotDoc(ctx.db, input.houseId, id));
  }
  await batch.commit();
}

/**
 * Housekeeping that any member may trigger (the dashboard does, on load):
 * deletes bookings whose slot has passed, together with their slot locks, and log
 * entries older than the retention window. Bounded so one call stays well under
 * Firestore's 500-write batch limit.
 */
export async function pruneOldRecords(ctx: ServerContext, input: { houseId: string }) {
  await requireMember(ctx, input.houseId);
  const cutoff = Timestamp.fromMillis(
    Date.now() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const [expired, stale] = await Promise.all([
    getDocs(
      query(
        bookingsCol(ctx.db, input.houseId),
        where("endAt", "<=", Timestamp.now()),
        orderBy("endAt"),
        limit(15),
      ),
    ),
    getDocs(
      query(
        sessionsCol(ctx.db, input.houseId),
        where("startedAt", "<=", cutoff),
        orderBy("startedAt"),
        limit(15),
      ),
    ),
  ]);
  if (expired.empty && stale.empty) return { bookings: 0, sessions: 0 };

  const batch = writeBatch(ctx.db);
  expired.forEach((snap) => {
    const booking = snap.data() as Omit<Booking, "id">;
    batch.delete(snap.ref);
    for (const id of slotIdsForRange(
      booking.machineId,
      booking.startAt.toDate(),
      booking.endAt.toDate(),
    )) {
      batch.delete(slotDoc(ctx.db, input.houseId, id));
    }
  });
  stale.forEach((snap) => batch.delete(snap.ref));
  await batch.commit();
  return { bookings: expired.size, sessions: stale.size };
}

/* ------------------------------------------------------------------ admin settings */

export async function addMachine(
  ctx: ServerContext,
  input: { houseId: string; name: string; type: MachineType },
) {
  await requireAdmin(ctx, input.houseId);
  const name = input.name.trim();
  if (!name) fail("Give the machine a name.");
  if (!MACHINE_TYPES.includes(input.type)) fail("Unknown machine type.");
  // New machines go last; the admin can drag them elsewhere in settings.
  const existing = await getDocs(query(machinesCol(ctx.db, input.houseId), limit(50)));
  const order = existing.docs.reduce(
    (max, d) => Math.max(max, ((d.data() as Machine).order ?? -1) + 1),
    existing.size,
  );
  const ref = doc(machinesCol(ctx.db, input.houseId));
  const batch = writeBatch(ctx.db);
  batch.set(ref, {
    name,
    type: input.type,
    status: "free",
    currentSession: null,
    cycles: DEFAULT_CYCLES[input.type],
    maxMinutes: DEFAULT_MAX_MINUTES[input.type],
    order,
  });
  await batch.commit();
  return { machineId: ref.id };
}

/** Named cycle presets and the longest custom cycle allowed, per machine. */
export async function updateMachineCycles(
  ctx: ServerContext,
  input: { houseId: string; machineId: string; cycles: Cycle[]; maxMinutes: number },
) {
  await requireAdmin(ctx, input.houseId);
  const maxMinutes = input.maxMinutes;
  if (
    !Number.isInteger(maxMinutes) ||
    maxMinutes < 15 ||
    maxMinutes > ABSOLUTE_MAX_MINUTES
  ) {
    fail(`The maximum has to be between 15 and ${ABSOLUTE_MAX_MINUTES} minutes.`);
  }
  if (!Array.isArray(input.cycles) || input.cycles.length === 0) {
    fail("Keep at least one cycle.");
  }
  if (input.cycles.length > MAX_CYCLES_PER_MACHINE) {
    fail(`At most ${MAX_CYCLES_PER_MACHINE} cycles per machine.`);
  }
  const cycles: Cycle[] = input.cycles.map((c) => {
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (!name || name.length > 24) fail("Cycle names are 1 to 24 characters.");
    if (!Number.isInteger(c.minutes) || c.minutes < 1 || c.minutes > maxMinutes) {
      fail(`"${name}" has to be between 1 and ${maxMinutes} minutes.`);
    }
    return { name, minutes: c.minutes };
  });
  if (new Set(cycles.map((c) => c.name.toLowerCase())).size !== cycles.length) {
    fail("Cycle names have to be unique.");
  }
  const ref = machineDoc(ctx.db, input.houseId, input.machineId);
  if (!(await getDoc(ref)).exists()) fail("That machine no longer exists.");
  await updateDoc(ref, { cycles, maxMinutes });
}

/** Persists the drag-and-drop order from settings: position in `machineIds` becomes `order`. */
export async function reorderMachines(
  ctx: ServerContext,
  input: { houseId: string; machineIds: string[] },
) {
  await requireAdmin(ctx, input.houseId);
  const ids = input.machineIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50)
    fail("Nothing to reorder.");
  if (new Set(ids).size !== ids.length) fail("Each machine can only appear once.");

  const existing = await getDocs(query(machinesCol(ctx.db, input.houseId), limit(50)));
  const known = new Set(existing.docs.map((d) => d.id));
  if (ids.some((id) => !known.has(id)) || known.size !== ids.length) {
    fail("The machine list changed. Reload and try again.");
  }

  const batch = writeBatch(ctx.db);
  ids.forEach((id, order) =>
    batch.update(machineDoc(ctx.db, input.houseId, id), { order }),
  );
  await batch.commit();
}

export async function renameMachine(
  ctx: ServerContext,
  input: { houseId: string; machineId: string; name: string },
) {
  await requireAdmin(ctx, input.houseId);
  const name = input.name.trim();
  if (!name) fail("Give the machine a name.");
  await updateDoc(machineDoc(ctx.db, input.houseId, input.machineId), { name });
}

export async function removeMachine(
  ctx: ServerContext,
  input: { houseId: string; machineId: string },
) {
  await requireAdmin(ctx, input.houseId);
  const ref = machineDoc(ctx.db, input.houseId, input.machineId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  if ((snap.data() as Machine).status === "in_use") {
    fail("Stop the running cycle before removing it.");
  }
  const batch = writeBatch(ctx.db);
  batch.delete(ref);
  await batch.commit();
}

function cleanSchedule(schedule: Schedule, groups: string[]): Schedule {
  const cleaned = {} as Schedule;
  for (const day of WEEKDAYS) {
    const owner = schedule?.[day] ?? null;
    cleaned[day] = owner && groups.includes(owner) ? owner : null;
  }
  return cleaned;
}

export async function updateSchedule(
  ctx: ServerContext,
  input: { houseId: string; schedule: Schedule },
) {
  const { house } = await requireAdmin(ctx, input.houseId);
  await updateDoc(houseDoc(ctx.db, input.houseId), {
    schedule: cleanSchedule(input.schedule, house.groups),
  });
}

/** Each person's own choice, inside whatever the admin allows for the house. */
export async function setMyEmailReminders(
  ctx: ServerContext,
  input: { houseId: string; enabled: boolean },
) {
  const { member } = await requireMember(ctx, input.houseId);
  if (typeof input.enabled !== "boolean") fail("That setting has to be on or off.");
  await updateDoc(memberDoc(ctx.db, input.houseId, member.uid), {
    emailReminders: input.enabled,
  });
}

/** Whether the invite code admits people straight away, or only asks the admin. */
export async function setJoinApproval(
  ctx: ServerContext,
  input: { houseId: string; required: boolean },
) {
  const { house } = await requireAdmin(ctx, input.houseId);
  if (typeof input.required !== "boolean") fail("That setting has to be on or off.");

  // Both copies, because the invite document is what a newcomer actually reads.
  const batch = writeBatch(ctx.db);
  batch.update(houseDoc(ctx.db, input.houseId), { requireApproval: input.required });
  batch.update(inviteCodeDoc(ctx.db, house.inviteCode), {
    requireApproval: input.required,
  });
  await batch.commit();
}

/** Admin's answer to one request. Approving lets that person finish joining themselves. */
export async function decideJoinRequest(
  ctx: ServerContext,
  input: { houseId: string; uid: string; approve: boolean },
) {
  await requireAdmin(ctx, input.houseId);
  const ref = joinRequestDoc(ctx.db, input.houseId, input.uid);
  if (!(await getDoc(ref)).exists()) fail("That request is no longer there.");
  await updateDoc(ref, {
    status: input.approve ? "approved" : "declined",
    decidedAt: Timestamp.now(),
  });
}

/** Whether finished cycles may send email at all. Admin only, and off in a new house. */
export async function setEmailReminders(
  ctx: ServerContext,
  input: { houseId: string; enabled: boolean; from?: string },
) {
  await requireAdmin(ctx, input.houseId);
  if (typeof input.enabled !== "boolean") fail("That setting has to be on or off.");

  const changes: { emailReminders: boolean; emailFrom?: string } = {
    emailReminders: input.enabled,
  };
  if (input.from !== undefined) {
    const sender = parseSender(input.from);
    if (!sender.ok) fail(sender.error);
    changes.emailFrom = sender.value;
  }
  if (
    input.enabled &&
    input.from === undefined &&
    !(await hasSender(ctx, input.houseId))
  ) {
    fail("Set the address the email should come from first.");
  }
  await updateDoc(houseDoc(ctx.db, input.houseId), changes);
}

async function hasSender(ctx: ServerContext, houseId: string): Promise<boolean> {
  const snap = await getDoc(houseDoc(ctx.db, houseId));
  return Boolean((snap.data() as House | undefined)?.emailFrom?.trim());
}

/** How strictly the day schedule applies, and which zone decides when a day starts. */
export async function updateScheduleSettings(
  ctx: ServerContext,
  input: { houseId: string; scheduleMode: ScheduleMode; timeZone: string },
) {
  await requireAdmin(ctx, input.houseId);
  if (!SCHEDULE_MODES.includes(input.scheduleMode)) fail("Unknown schedule mode.");
  if (!isValidTimeZone(input.timeZone)) fail("That time zone isn't recognised.");
  await updateDoc(houseDoc(ctx.db, input.houseId), {
    scheduleMode: input.scheduleMode,
    timeZone: input.timeZone,
  });
}

/** Group names live on the house and on the invite document, so both are kept in step. */
export async function updateHouseDetails(
  ctx: ServerContext,
  input: { houseId: string; name: string; groups: string[] },
) {
  const { house } = await requireAdmin(ctx, input.houseId);
  const name = input.name.trim();
  if (!name) fail("Give the house a name.");
  const groups = cleanGroups(input.groups);

  const batch = writeBatch(ctx.db);
  batch.update(houseDoc(ctx.db, input.houseId), {
    name,
    groups,
    schedule: cleanSchedule(house.schedule, groups),
  });
  batch.update(inviteCodeDoc(ctx.db, house.inviteCode), {
    houseName: name,
    groups,
    requireApproval: house.requireApproval === true,
  });

  // Members whose group disappeared are moved to the first remaining one.
  const members = await getDocs(query(membersCol(ctx.db, input.houseId), limit(200)));
  members.forEach((m) => {
    const group = (m.data() as Member).group;
    if (!groups.includes(group)) {
      batch.update(memberDoc(ctx.db, input.houseId, m.id), { group: groups[0] });
    }
  });

  await batch.commit();
}

export async function updateMemberGroup(
  ctx: ServerContext,
  input: { houseId: string; uid: string; group: string },
) {
  const { house } = await requireAdmin(ctx, input.houseId);
  if (!house.groups.includes(input.group)) fail("That group doesn't exist.");
  await updateDoc(memberDoc(ctx.db, input.houseId, input.uid), { group: input.group });
}

export async function removeMember(
  ctx: ServerContext,
  input: { houseId: string; uid: string },
) {
  const { house } = await requireAdmin(ctx, input.houseId);
  if (input.uid === house.adminUid) fail("The admin cannot be removed.");
  const batch = writeBatch(ctx.db);
  batch.delete(memberDoc(ctx.db, input.houseId, input.uid));
  await batch.commit();
}

export async function regenerateInviteCode(
  ctx: ServerContext,
  input: { houseId: string },
) {
  const { house } = await requireAdmin(ctx, input.houseId);
  const code = generateInviteCode();
  const batch = writeBatch(ctx.db);
  batch.set(inviteCodeDoc(ctx.db, code), {
    houseId: input.houseId,
    houseName: house.name,
    groups: house.groups,
    requireApproval: house.requireApproval === true,
  });
  batch.update(houseDoc(ctx.db, input.houseId), { inviteCode: code });
  batch.delete(inviteCodeDoc(ctx.db, house.inviteCode));
  await batch.commit();
  return { code };
}
