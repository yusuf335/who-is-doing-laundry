import "server-only";

import { createHash } from "node:crypto";
import { FirebaseError } from "firebase/app";
import { after } from "next/server";
import {
  deleteDoc,
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
import { DEFAULT_MACHINE_COLORS, normalizeHex } from "@/lib/machine-color";
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
  pushDeviceDoc,
  pushDevicesCol,
  slotDoc,
  userDoc,
} from "@/lib/paths";
import {
  MAX_CHASES,
  MAX_PUSH_DEVICES,
  NUDGE_EVERY_MINUTES,
  bookingLabel,
  bookingReleasedPush,
  bookingReminderAt,
  bookingSoonPush,
  bookingStartedPush,
  clockIn,
  cycleDonePush,
  cycleLabel,
  emptiedPush,
  isPushTarget,
  type PushChase,
  type PushPayload,
  type PushTarget,
} from "@/lib/push-message";
import { dayAccess, defaultSchedule } from "@/lib/schedule";
import { parseSender } from "@/lib/reminder";
import { pushConfigured, sendPush } from "@/server/push";
import { cancelLabelled, schedulePush, schedulingConfigured } from "@/server/qstash";
import {
  cancelScheduledEmail,
  remindersEnabled,
  renderBookingReleasedEmail,
  scheduleBookingReminder,
  scheduleCycleReminder,
  sendEmptiedEmail,
  sendTestEmail as deliverTestEmail,
} from "@/server/resend";
import { seal, unseal } from "@/server/seal";
import {
  MAX_BOOKING_MINUTES,
  SLOT_MINUTES,
  SERVER_MAX_AHEAD_MS,
  MAX_DAYS_AHEAD,
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
  NO_SHOW_MINUTES,
  SCHEDULE_MODES,
  SESSION_RETENTION_DAYS,
  WEEKDAYS,
  isNoShow,
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
      color: DEFAULT_MACHINE_COLORS[0],
    });
    batch.set(doc(machinesCol(ctx.db, houseId)), {
      name: "Dryer",
      type: "dryer",
      status: "free",
      currentSession: null,
      cycles: DEFAULT_CYCLES.dryer,
      maxMinutes: DEFAULT_MAX_MINUTES.dryer,
      order: 1,
      color: DEFAULT_MACHINE_COLORS[1],
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

  // A booking nobody started in time no longer holds the machine: clear it first, so
  // the slot check below does not mistake it for one that does.
  await releaseLapsed(ctx, input.houseId, input.machineId);

  let machineName = "machine";
  let machineColor: string | undefined;
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
    machineName = machine.name;
    machineColor = machine.color;
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
      const until = booking.endAt
        ? ` until ${clockIn(booking.endAt.toDate(), house.timeZone)}`
        : "";
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

  // Starting the machine checks in your booking for it: no more "start it" nudges, and
  // it will not be released.
  await checkIn(ctx, input.houseId, input.machineId, member.uid);

  // Only once the machine is ours: scheduling takes network round trips, and nothing
  // about the claim should wait on them. Each is best effort.
  // "Done", then every 15 minutes until somebody presses Emptied.
  const pushId = await schedulePushForMe(
    ctx,
    expectedEndAt.toDate(),
    cycleDonePush({ machineName, sessionId: sessionRef.id }),
    {
      chase: {
        machineName,
        sessionId: sessionRef.id,
        finishedAt: expectedEndAt.toMillis(),
        remaining: MAX_CHASES,
      },
      label: cycleLabel(sessionRef.id),
    },
  );

  // Sealed copy of this person's devices, so whoever empties the machine can tell them,
  // although they cannot read this person's device list themselves. Bound to this owner
  // and this cycle, so a copy pasted onto another cycle opens to nothing.
  const myTargets = pushConfigured() ? await myPushTargets(ctx).catch(() => []) : [];
  const ownerPush =
    myTargets.length > 0 ? seal(myTargets, `${member.uid}:${sessionRef.id}`) : null;
  const marks = { ...(pushId ? { pushId } : {}), ...(ownerPush ? { ownerPush } : {}) };
  if (Object.keys(marks).length > 0) {
    await updateDoc(sessionRef, marks).catch((error: unknown) => {
      // Without these the notification cannot be called off early, or the owner told
      // who emptied it; a nuisance only.
      console.error("store push marks", error);
    });
  }

  // Two gates: the admin turns email on for the house, and each person opts in for
  // themselves. Phone notifications are the main channel; email is for whoever wants it.
  if (house.emailReminders !== true || member.emailReminders !== true) return;

  const reminderId = await scheduleCycleReminder({
    to: member.email,
    displayName: member.displayName,
    machineName,
    houseName: house.name,
    finishesAt: expectedEndAt.toDate(),
    timeZone: house.timeZone,
    accent: machineColor,
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
  const { house, member, isAdmin } = await requireMember(ctx, input.houseId);
  const machineRef = machineDoc(ctx.db, input.houseId, input.machineId);
  let reminderToCancel: string | null = null;
  let endedSessionId: string | null = null;
  let ownerUid = "";
  let ownerName = "";
  let ownerPush: unknown = null;
  let machineName = "machine";
  let machineColor: string | undefined;
  let stopped = false;

  await runTransaction(ctx.db, async (tx) => {
    const snap = await tx.get(machineRef);
    if (!snap.exists()) fail("That machine no longer exists.");
    const machine = snap.data() as Omit<Machine, "id">;
    const session = machine.currentSession;
    if (machine.status === "free" || !session) return;
    ownerUid = session.uid;
    ownerName = session.displayName;
    endedSessionId = session.sessionId ?? null;
    machineName = machine.name;
    machineColor = machine.color;

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
    // It also says who pressed the button, so "who emptied my washing?" has an answer.
    if (logRef && logSnap?.exists()) {
      tx.update(logRef, {
        endedAt: Timestamp.now(),
        endedByUid: member.uid,
        endedByName: member.displayName,
      });
    }

    ownerPush = logSnap?.data()?.ownerPush ?? null;
    stopped = session.expectedEndAt.toMillis() > Date.now();

    // Stopped early, so the "your wash is done" email is no longer true.
    if (session.expectedEndAt.toMillis() > Date.now()) {
      const pending = logSnap?.data()?.reminderId;
      if (typeof pending === "string") reminderToCancel = pending;
    }
  });

  if (reminderToCancel) {
    await cancelScheduledEmail(
      reminderToCancel,
      await emailOf(ctx, input.houseId, ownerUid),
    );
  }
  // Somebody else emptied (or stopped) it: tell the owner who, and confirm it to them.
  if (endedSessionId && ownerUid && ownerUid !== member.uid) {
    await tellAboutEmptying(ctx, {
      house,
      houseId: input.houseId,
      emptier: member,
      ownerUid,
      ownerName,
      ownerPush,
      machineName,
      machineColor,
      sessionId: endedSessionId,
      stopped,
    });
  }

  // Emptied or stopped: the "done" notification and every "still waiting" repeat stop.
  if (endedSessionId && schedulingConfigured()) {
    const label = cycleLabel(endedSessionId);
    await cancelLabelled(label);
    // A repeat being delivered at this very moment schedules its successor after the
    // cancel above, so look again a few seconds later, once the response has gone.
    later(async () => {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      await cancelLabelled(label);
    });
  }
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
  if (input.startMs > Date.now() + SERVER_MAX_AHEAD_MS) {
    fail(`Bookings open up to ${MAX_DAYS_AHEAD / 7} weeks ahead.`);
  }

  // The day the booking starts on decides; it may run past midnight.
  const access = dayAccess(house, member, start);
  if (!access.allowed) fail(access.reason!);

  const machine = await getDoc(machineDoc(ctx.db, input.houseId, input.machineId));
  if (!machine.exists()) fail("That machine no longer exists.");
  // A running cycle is not a booking, so the slots below would not catch it.
  const {
    name: machineName,
    color: machineColorOf,
    status,
    currentSession: running,
  } = machine.data() as Machine;
  if (
    status === "in_use" &&
    running &&
    running.expectedEndAt.toMillis() > start.getTime()
  ) {
    fail(
      `${machineName} is in use until ${clockIn(running.expectedEndAt.toDate(), house.timeZone)}.`,
    );
  }

  // A booking nobody started in time is free for others: clear it before checking.
  await releaseLapsed(ctx, input.houseId, input.machineId);

  const slotIds = slotIdsForRange(input.machineId, start, end);
  const bookingRef = doc(bookingsCol(ctx.db, input.houseId));

  const overlaps = (clash: { displayName?: string; startAt?: Timestamp }) => {
    const who = clash.displayName ?? "someone";
    const when = clash.startAt
      ? ` at ${clockIn(clash.startAt.toDate(), house.timeZone)}`
      : "";
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

  await scheduleBookingNotifications(ctx, {
    house,
    member,
    bookingId: bookingRef.id,
    machineName,
    machineColor: machineColorOf,
    start,
    end,
  });

  return { bookingId: bookingRef.id };
}

/**
 * Everything a booking sends its booker: "in 15 minutes" (phone, and email when both
 * switches are on); "it has started, start it" at the start and every five minutes;
 * and "released" (phone and email) at fifteen minutes if they never started. All carry
 * the booking's label, so starting the machine or cancelling the booking calls every
 * one of them off.
 *
 * Marks the booking scheduled when anything was handed over, so the catch-up never
 * does it twice. Left unmarked when nothing could be (no devices, email off), so it is
 * picked up later, for instance once this person turns notifications on.
 */
async function scheduleBookingNotifications(
  ctx: ServerContext,
  input: {
    house: House;
    member: Member;
    bookingId: string;
    machineName: string;
    machineColor?: string;
    start: Date;
    end: Date;
  },
): Promise<boolean> {
  const { house, member, bookingId, machineName, start, end } = input;
  const label = bookingLabel(bookingId);
  const emailOn =
    remindersEnabled() && house.emailReminders === true && member.emailReminders === true;
  const targets = schedulingConfigured() ? await myPushTargets(ctx).catch(() => []) : [];
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
  const due = (when: Date) => when.getTime() > Date.now() + 30_000;
  const releasedAt = at(NO_SHOW_MINUTES);
  const remindAt = bookingReminderAt(start.getTime(), Date.now());

  // Nothing could reach them (no device, email off, or it is all in the past): leave it
  // unmarked, so it is picked up once they have a way to be reached.
  const anythingDue = [remindAt, at(0), releasedAt].some((when) => when && due(when));
  if (!anythingDue || (targets.length === 0 && !emailOn)) return false;

  // Claim it first. Only if the mark is saved does anything get scheduled, so a refused
  // write (rules not deployed, a race with another tab) can never schedule twice.
  const claimed = await updateDoc(bookingDoc(ctx.db, house.id, bookingId), {
    scheduled: true,
  })
    .then(() => true)
    .catch((error: unknown) => {
      console.error("claim booking notifications", error);
      return false;
    });
  if (!claimed) return false;

  const releaseEmail =
    emailOn && schedulingConfigured() && due(releasedAt)
      ? await renderBookingReleasedEmail({
          to: member.email,
          from: house.emailFrom,
          displayName: member.displayName,
          machineName,
          houseName: house.name,
          startsAt: start,
          endsAt: end,
          timeZone: house.timeZone,
          accent: input.machineColor,
        })
      : null;

  const pushes: Promise<string | null>[] = [];
  if (targets.length > 0) {
    if (remindAt) {
      pushes.push(
        schedulePush(
          remindAt,
          {
            payload: bookingSoonPush({
              machineName,
              bookingId,
              start,
              timeZone: house.timeZone,
            }),
            targets,
          },
          { label },
        ),
      );
    }
    for (const minutes of [0, NUDGE_EVERY_MINUTES, 2 * NUDGE_EVERY_MINUTES]) {
      if (!due(at(minutes))) continue;
      pushes.push(
        schedulePush(
          at(minutes),
          {
            payload: bookingStartedPush({
              machineName,
              bookingId,
              minutesLeft: NO_SHOW_MINUTES - minutes,
            }),
            targets,
          },
          { label },
        ),
      );
    }
  }
  if (due(releasedAt) && (targets.length > 0 || releaseEmail)) {
    pushes.push(
      schedulePush(
        releasedAt,
        {
          payload: bookingReleasedPush({
            machineName,
            bookingId,
            releasedAt,
            timeZone: house.timeZone,
          }),
          targets,
          ...(releaseEmail ? { email: releaseEmail } : {}),
        },
        { label },
      ),
    );
  }

  const [reminderId, ...pushIds] = await Promise.all([
    emailOn && remindAt
      ? scheduleBookingReminder(
          {
            to: member.email,
            from: house.emailFrom,
            displayName: member.displayName,
            machineName,
            houseName: house.name,
            startsAt: start,
            endsAt: end,
            timeZone: house.timeZone,
            accent: input.machineColor,
          },
          remindAt,
        )
      : Promise.resolve(null),
    ...pushes,
  ]);

  // The email's id, so it can be called off if the booking is cancelled.
  if (reminderId) {
    await updateDoc(bookingDoc(ctx.db, house.id, bookingId), { reminderId }).catch(
      (error: unknown) => console.error("store reminder id", error),
    );
  }
  return Boolean(reminderId) || pushIds.some(Boolean);
}

/**
 * Schedules the notifications for the caller's own upcoming bookings that have none
 * yet: ones made before notifications existed, or while they had no device. Run when
 * the app opens and when notifications are turned on. Only ever for the caller,
 * because only they can read their devices.
 */
export async function catchUpNotifications(
  ctx: ServerContext,
  input: { houseId: string },
) {
  const { house, member } = await requireMember(ctx, input.houseId);
  if (!schedulingConfigured() && !remindersEnabled()) return { scheduled: 0 };

  const now = Date.now();
  const mine = await getDocs(
    query(bookingsCol(ctx.db, input.houseId), where("uid", "==", member.uid), limit(50)),
  );
  const pending = mine.docs.filter((snap) => {
    const booking = snap.data() as Omit<Booking, "id"> & {
      scheduled?: boolean;
      pushId?: string;
      reminderId?: string;
    };
    return (
      booking.endAt.toMillis() > now &&
      !booking.checkedInAt &&
      // Already handled: by this, or by the notifications of a booking made since.
      !booking.scheduled &&
      !booking.pushId &&
      !booking.reminderId &&
      !isNoShow(booking, now)
    );
  });
  if (pending.length === 0) return { scheduled: 0 };

  const machines = await getDocs(query(machinesCol(ctx.db, input.houseId), limit(50)));
  const machineById = new Map(machines.docs.map((d) => [d.id, d.data() as Machine]));

  let scheduled = 0;
  for (const snap of pending) {
    const booking = snap.data() as Omit<Booking, "id">;
    const machine = machineById.get(booking.machineId);
    if (!machine) continue;
    const done = await scheduleBookingNotifications(ctx, {
      house,
      member,
      bookingId: snap.id,
      machineName: machine.name,
      machineColor: machine.color,
      start: booking.startAt.toDate(),
      end: booking.endAt.toDate(),
    });
    if (done) scheduled++;
  }
  return { scheduled };
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

  // Its "starts soon" reminders would now be about nothing.
  const { reminderId } = booking as { reminderId?: unknown };
  if (typeof reminderId === "string" && booking.startAt.toMillis() > Date.now()) {
    const ownerEmail =
      booking.uid === member.uid
        ? member.email
        : await emailOf(ctx, input.houseId, booking.uid);
    await cancelScheduledEmail(reminderId, ownerEmail);
  }
  // Everything still due about it: the reminder, the nudges, the release notice.
  if (schedulingConfigured()) await cancelLabelled(bookingLabel(input.bookingId));
}

/**
 * Housekeeping that any member may trigger (the dashboard does, on load):
 * deletes bookings whose slot has passed, together with their slot locks, and log
 * entries older than the retention window. Bounded so one call stays well under
 * Firestore's 500-write batch limit.
 */
/**
 * Deletes bookings nobody started within {@link NO_SHOW_MINUTES} of their start, with
 * their slot locks, so the time is genuinely free. On one machine before booking or
 * starting it, or across the house when the app tidies up. The rules allow any member
 * this, and only for a booking that really has lapsed.
 */
async function releaseLapsed(
  ctx: ServerContext,
  houseId: string,
  machineId?: string,
): Promise<number> {
  const now = Date.now();
  const snaps = await getDocs(
    query(
      bookingsCol(ctx.db, houseId),
      where("startAt", ">=", Timestamp.fromMillis(now - MAX_BOOKING_MINUTES * 60_000)),
      where("startAt", "<=", Timestamp.fromMillis(now - NO_SHOW_MINUTES * 60_000)),
      limit(50),
    ),
  ).catch((error: unknown) => {
    console.error("find lapsed bookings", error);
    return null;
  });
  const lapsed = (snaps?.docs ?? []).filter((snap) => {
    const booking = snap.data() as Omit<Booking, "id">;
    return (!machineId || booking.machineId === machineId) && isNoShow(booking, now);
  });
  if (lapsed.length === 0) return 0;

  const batch = writeBatch(ctx.db);
  for (const snap of lapsed) {
    const booking = snap.data() as Omit<Booking, "id">;
    batch.delete(snap.ref);
    for (const id of slotIdsForRange(
      booking.machineId,
      booking.startAt.toDate(),
      booking.endAt.toDate(),
    )) {
      batch.delete(slotDoc(ctx.db, houseId, id));
    }
  }
  await batch.commit().catch((error: unknown) => {
    // Someone else got there first, or it was started meanwhile. Either way it is fine.
    console.error("release lapsed bookings", error);
  });
  return lapsed.length;
}

/**
 * Starting a machine checks in the caller's booking for it, if one has started (or
 * starts within the next {@link NO_SHOW_MINUTES} minutes): its nudges and release
 * notice are cancelled, and it no longer lapses.
 */
async function checkIn(
  ctx: ServerContext,
  houseId: string,
  machineId: string,
  uid: string,
): Promise<void> {
  const now = Date.now();
  const mine = await getDocs(
    query(bookingsCol(ctx.db, houseId), where("uid", "==", uid), limit(50)),
  ).catch(() => null);
  const due = (mine?.docs ?? []).filter((snap) => {
    const booking = snap.data() as Omit<Booking, "id">;
    return (
      booking.machineId === machineId &&
      !booking.checkedInAt &&
      booking.startAt.toMillis() - NO_SHOW_MINUTES * 60_000 <= now &&
      booking.endAt.toMillis() > now
    );
  });
  await Promise.all(
    due.map(async (snap) => {
      await updateDoc(snap.ref, { checkedInAt: serverTimestamp() }).catch(
        (error: unknown) => console.error("check in", error),
      );
      if (schedulingConfigured()) await cancelLabelled(bookingLabel(snap.id));
    }),
  );
}

export async function pruneOldRecords(ctx: ServerContext, input: { houseId: string }) {
  await requireMember(ctx, input.houseId);
  await releaseLapsed(ctx, input.houseId);
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

/* ------------------------------------------------------------------ notifications */

/**
 * "Ada emptied your Washer" for the owner and "You emptied Mo's Washer" for Ada, by
 * phone and by email. Everything that needs reading is read now, while signed in as
 * Ada; the sending happens after the response, so pressing Emptied stays quick.
 * Each email still respects its recipient's own switch.
 */
async function tellAboutEmptying(
  ctx: ServerContext,
  input: {
    house: House;
    houseId: string;
    emptier: Member;
    ownerUid: string;
    ownerName: string;
    ownerPush: unknown;
    machineName: string;
    machineColor?: string;
    sessionId: string;
    stopped: boolean;
  },
) {
  const { house, emptier } = input;
  const canPush = pushConfigured();
  const canEmail = remindersEnabled() && house.emailReminders === true;
  if (!canPush && !canEmail) return;

  const at = new Date();
  // Only opens for the cycle and owner it was sealed for, so a copy is useless.
  const opened = unseal(input.ownerPush, `${input.ownerUid}:${input.sessionId}`);
  const ownerTargets = Array.isArray(opened) ? opened.filter(isPushTarget) : [];
  const emptierTargets = canPush ? await myPushTargets(ctx).catch(() => []) : [];
  const owner = canEmail
    ? ((await getDoc(memberDoc(ctx.db, input.houseId, input.ownerUid))
        .then((snap) => snap.data() as Member | undefined)
        .catch(() => undefined)) ?? null)
    : null;

  const common = {
    ownerName: input.ownerName,
    emptierName: emptier.displayName,
    machineName: input.machineName,
    stopped: input.stopped,
    timeZone: house.timeZone,
  };

  const email = (role: "owner" | "emptier", recipient: Member | null) =>
    canEmail && recipient?.email && recipient.emailReminders === true
      ? sendEmptiedEmail({
          ...common,
          role,
          to: recipient.email,
          from: house.emailFrom,
          recipientName: recipient.displayName,
          houseName: house.name,
          at,
          accent: input.machineColor,
        })
      : null;

  later(async () => {
    await Promise.all([
      sendPush(
        ownerTargets,
        emptiedPush({ ...common, to: "owner", sessionId: input.sessionId, at }),
      ),
      sendPush(
        emptierTargets,
        emptiedPush({ ...common, to: "emptier", sessionId: input.sessionId, at }),
      ),
      email("owner", owner),
      email("emptier", emptier),
    ]).catch((error: unknown) => console.error("tell about emptying", error));
  });
}

/**
 * Work that should not hold up the response, such as notifications. Inside a request
 * Next runs it once the response has gone; anywhere else (tests, scripts) it simply
 * runs in the background.
 */
function later(work: () => Promise<void>) {
  try {
    after(work);
  } catch {
    void work().catch((error: unknown) => console.error("later", error));
  }
}

/** A member's address, to check a scheduled email is theirs before calling it off. */
async function emailOf(
  ctx: ServerContext,
  houseId: string,
  uid: string,
): Promise<string> {
  if (!uid) return "";
  const snap = await getDoc(memberDoc(ctx.db, houseId, uid)).catch(() => null);
  return (snap?.data() as Member | undefined)?.email ?? "";
}

/** A stable id per browser, so subscribing twice updates one document. */
function deviceId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 40);
}

/** The caller's own devices, read as the caller. Nobody else's are ever readable. */
async function myPushTargets(ctx: ServerContext): Promise<PushTarget[]> {
  const snap = await getDocs(
    query(pushDevicesCol(ctx.db, ctx.user.uid), limit(MAX_PUSH_DEVICES)),
  );
  return snap.docs
    .map((d) => d.data())
    .filter(isPushTarget)
    .map(({ endpoint, keys }) => ({
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    }));
}

/**
 * Schedules a notification to every device the caller has allowed. The devices are read
 * now, as the caller, and travel with the message, which is why delivery needs no key.
 * A device switched on later only hears about things scheduled after that.
 */
async function schedulePushForMe(
  ctx: ServerContext,
  at: Date,
  payload: PushPayload,
  options: { chase?: PushChase; label?: string } = {},
): Promise<string | null> {
  if (!schedulingConfigured()) return null;
  try {
    const targets = await myPushTargets(ctx);
    if (targets.length === 0) return null;
    return await schedulePush(
      at,
      { payload, targets, chase: options.chase },
      { label: options.label },
    );
  } catch (error) {
    console.error("schedule push", error);
    return null;
  }
}

async function forgetDevices(ctx: ServerContext, endpoints: string[]) {
  await Promise.all(
    endpoints.map((endpoint) =>
      deleteDoc(pushDeviceDoc(ctx.db, ctx.user.uid, deviceId(endpoint))).catch(
        (error: unknown) => console.error("forget push device", error),
      ),
    ),
  );
}

/** Remembers this browser so cycles and bookings can notify it. */
export async function savePushDevice(
  ctx: ServerContext,
  input: { subscription: unknown; label: string },
) {
  if (!pushConfigured()) fail("Phone notifications are not set up on this server yet.");
  if (!isPushTarget(input.subscription)) {
    fail("This browser did not give a usable notification address.");
  }
  const { endpoint, keys } = input.subscription;
  const label =
    (typeof input.label === "string" ? input.label.trim().slice(0, 60) : "") ||
    "This device";

  const id = deviceId(endpoint);
  const existing = await getDocs(
    query(pushDevicesCol(ctx.db, ctx.user.uid), limit(MAX_PUSH_DEVICES + 1)),
  );
  if (!existing.docs.some((d) => d.id === id) && existing.size >= MAX_PUSH_DEVICES) {
    fail(
      `Notifications are on for ${MAX_PUSH_DEVICES} devices already. Turn them off on one you no longer use.`,
    );
  }
  await setDoc(pushDeviceDoc(ctx.db, ctx.user.uid, id), {
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    label,
    createdAt: Timestamp.now(),
  });
}

/** Forgets this browser, so nothing more is sent to it. */
export async function removePushDevice(ctx: ServerContext, input: { endpoint: string }) {
  if (typeof input.endpoint !== "string" || !input.endpoint) fail("Nothing to turn off.");
  await deleteDoc(pushDeviceDoc(ctx.db, ctx.user.uid, deviceId(input.endpoint)));
}

/** Sends a notification right now to every device the caller has allowed. */
/**
 * Sends a notification right now to the browser asking, and only to it, so the result
 * says something about this device rather than any of the person's devices. The
 * subscription is saved again first, in case the browser replaced it since.
 */
export async function sendTestPush(
  ctx: ServerContext,
  input: { subscription: unknown; label: string },
) {
  await savePushDevice(ctx, input);
  const target = input.subscription as PushTarget;
  const { sent, gone, refused } = await sendPush(
    [{ endpoint: target.endpoint, keys: target.keys }],
    {
      title: "Notifications are on",
      body: "You will hear from us when your laundry is done and before your bookings.",
      // Its own tag each time, so a test never silently replaces the last one.
      tag: `test-${Date.now()}`,
      url: "/settings",
    },
  );
  if (gone.length > 0) {
    await forgetDevices(ctx, gone);
    fail(
      "This browser's notification address has expired. Turn notifications off and on.",
    );
  }
  if (sent === 0) {
    fail(
      `The push service refused it${refused[0] ? ` (status ${refused[0]})` : ""}. Turn notifications off and on, then try again.`,
    );
  }
  return { sent };
}

/** Emails the caller now, to check that reminders reach them. */
export async function sendTestEmail(ctx: ServerContext, input: { houseId: string }) {
  const { house, member } = await requireMember(ctx, input.houseId);
  if (!remindersEnabled()) fail("Email is not set up on this server yet.");
  if (house.emailReminders !== true) fail("Your house admin has email switched off.");
  if (!member.email) fail("Your account has no email address to send to.");
  const to = await deliverTestEmail({
    to: member.email,
    from: house.emailFrom,
    displayName: member.displayName,
    houseName: house.name,
  });
  if (!to) fail("The email service refused it. Check the sender address in settings.");
  return { to };
}

/* ------------------------------------------------------------------ admin settings */

export async function addMachine(
  ctx: ServerContext,
  input: { houseId: string; name: string; type: MachineType; color?: string },
) {
  await requireAdmin(ctx, input.houseId);
  const name = input.name.trim();
  if (!name) fail("Give the machine a name.");
  if (!MACHINE_TYPES.includes(input.type)) fail("Unknown machine type.");
  const color = input.color === undefined ? null : cleanColor(input.color);
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
    ...(color ? { color } : {}),
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

function cleanColor(value: string): string {
  const color = typeof value === "string" ? normalizeHex(value) : null;
  if (!color) fail("Pick a colour.");
  return color;
}

/** The colour that tells this machine apart on the calendar. Any `#rrggbb` will do. */
export async function setMachineColor(
  ctx: ServerContext,
  input: { houseId: string; machineId: string; color: string },
) {
  await requireAdmin(ctx, input.houseId);
  const color = cleanColor(input.color);
  const ref = machineDoc(ctx.db, input.houseId, input.machineId);
  if (!(await getDoc(ref)).exists()) fail("That machine no longer exists.");
  await updateDoc(ref, { color });
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
/** Phone notifications on or off for the caller's account, kept like the email switch. */
export async function setMyPushReminders(
  ctx: ServerContext,
  input: { houseId: string; enabled: boolean },
) {
  const { member } = await requireMember(ctx, input.houseId);
  if (typeof input.enabled !== "boolean") fail("That setting has to be on or off.");
  await updateDoc(memberDoc(ctx.db, input.houseId, member.uid), {
    pushReminders: input.enabled,
  });
}

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
  const target = await getDoc(memberDoc(ctx.db, input.houseId, input.uid));
  if (!target.exists()) return { bookingsCancelled: 0 };
  const removed = target.data() as Member;

  // The same rule as leaving: nobody is removed with their laundry still claiming a
  // machine. The admin can stop or empty it first.
  const machines = await getDocs(query(machinesCol(ctx.db, input.houseId), limit(50)));
  const running = machines.docs.find(
    (d) => (d.data() as Machine).currentSession?.uid === input.uid,
  );
  if (running) {
    fail(
      `${(running.data() as Machine).name} is running ${removed.displayName}'s cycle. Stop or empty it first.`,
    );
  }

  // Their bookings go with them, so the calendar does not show slots held by someone
  // who can no longer use them.
  const bookings = await getDocs(
    query(bookingsCol(ctx.db, input.houseId), where("uid", "==", input.uid), limit(50)),
  );
  const removal = (clearPointer: boolean) => {
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
    batch.delete(memberDoc(ctx.db, input.houseId, input.uid));
    // Their own record stops naming this house, so their app goes straight to
    // onboarding instead of waiting on a house it can no longer read. The rules allow an
    // admin this one change, and only together with the removal.
    if (clearPointer) batch.update(userDoc(ctx.db, input.uid), { houseId: null });
    return batch.commit();
  };
  await removal(true).catch(async (error: unknown) => {
    // Their own record could not be cleared (missing, or rules from before this change):
    // remove them anyway. Their app clears it the next time it opens.
    if (!(error instanceof FirebaseError)) throw error;
    if (error.code !== "not-found" && error.code !== "permission-denied") throw error;
    await removal(false);
  });

  // Their pending "starts soon" reminders would now be about nothing.
  await Promise.all(
    bookings.docs.map(async (snap) => {
      const booking = snap.data() as Omit<Booking, "id"> & {
        reminderId?: unknown;
      };
      if (booking.startAt.toMillis() <= Date.now()) return;
      if (schedulingConfigured()) await cancelLabelled(bookingLabel(snap.id));
      if (typeof booking.reminderId === "string") {
        await cancelScheduledEmail(booking.reminderId, removed.email);
      }
    }),
  );

  return { bookingsCancelled: bookings.size };
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
