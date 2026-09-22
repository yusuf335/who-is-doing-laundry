"use server";

import { errorMessage } from "@/lib/errors";
import { withServerUser, type ServerContext } from "@/lib/firebase-server";
import type {
  Cycle,
  InviteLookup,
  MachineType,
  Schedule,
  ScheduleMode,
} from "@/lib/types";
import * as laundry from "@/server/laundry";

/**
 * Server actions never throw: Next.js replaces thrown messages with a generic one in
 * production, so every action returns this envelope and the client unwraps it.
 */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

async function act<T>(
  work: (ctx: ServerContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const data = await withServerUser(work);
    if (data === null) return { ok: false, error: "Please sign in again." };
    return { ok: true, data: data as T };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/* onboarding */

export async function createHouseAction(input: laundry.CreateHouseInput) {
  return act((ctx) => laundry.createHouse(ctx, input));
}

export async function lookupInviteCodeAction(
  code: string,
): Promise<ActionResult<InviteLookup>> {
  return act((ctx) => laundry.lookupInviteCode(ctx, code));
}

export async function joinHouseAction(input: {
  code: string;
  displayName: string;
  group: string;
}) {
  return act((ctx) => laundry.joinHouse(ctx, input));
}

export async function leaveHouseAction(input: { houseId: string }) {
  return act((ctx) => laundry.leaveHouse(ctx, input));
}

export async function clearHousePointerAction() {
  return act((ctx) => laundry.clearHousePointer(ctx));
}

/* machines */

export async function startSessionAction(input: {
  houseId: string;
  machineId: string;
  minutes: number;
}) {
  return act((ctx) => laundry.startSession(ctx, input));
}

export async function endSessionAction(input: { houseId: string; machineId: string }) {
  return act((ctx) => laundry.endSession(ctx, input));
}

/* bookings */

export async function createBookingAction(input: {
  houseId: string;
  machineId: string;
  startMs: number;
  endMs: number;
}) {
  return act((ctx) => laundry.createBooking(ctx, input));
}

export async function cancelBookingAction(input: { houseId: string; bookingId: string }) {
  return act((ctx) => laundry.cancelBooking(ctx, input));
}

export async function pruneOldRecordsAction(input: { houseId: string }) {
  return act((ctx) => laundry.pruneOldRecords(ctx, input));
}

/* admin settings */

export async function addMachineAction(input: {
  houseId: string;
  name: string;
  type: MachineType;
}) {
  return act((ctx) => laundry.addMachine(ctx, input));
}

export async function renameMachineAction(input: {
  houseId: string;
  machineId: string;
  name: string;
}) {
  return act((ctx) => laundry.renameMachine(ctx, input));
}

export async function removeMachineAction(input: { houseId: string; machineId: string }) {
  return act((ctx) => laundry.removeMachine(ctx, input));
}

export async function updateMachineCyclesAction(input: {
  houseId: string;
  machineId: string;
  cycles: Cycle[];
  maxMinutes: number;
}) {
  return act((ctx) => laundry.updateMachineCycles(ctx, input));
}

export async function reorderMachinesAction(input: {
  houseId: string;
  machineIds: string[];
}) {
  return act((ctx) => laundry.reorderMachines(ctx, input));
}

export async function updateScheduleAction(input: {
  houseId: string;
  schedule: Schedule;
}) {
  return act((ctx) => laundry.updateSchedule(ctx, input));
}

export async function setMyEmailRemindersAction(input: {
  houseId: string;
  enabled: boolean;
}) {
  return act((ctx) => laundry.setMyEmailReminders(ctx, input));
}

export async function setJoinApprovalAction(input: {
  houseId: string;
  required: boolean;
}) {
  return act((ctx) => laundry.setJoinApproval(ctx, input));
}

export async function decideJoinRequestAction(input: {
  houseId: string;
  uid: string;
  approve: boolean;
}) {
  return act((ctx) => laundry.decideJoinRequest(ctx, input));
}

export async function setEmailRemindersAction(input: {
  houseId: string;
  enabled: boolean;
  from?: string;
}) {
  return act((ctx) => laundry.setEmailReminders(ctx, input));
}

export async function updateScheduleSettingsAction(input: {
  houseId: string;
  scheduleMode: ScheduleMode;
  timeZone: string;
}) {
  return act((ctx) => laundry.updateScheduleSettings(ctx, input));
}

export async function updateHouseDetailsAction(input: {
  houseId: string;
  name: string;
  groups: string[];
}) {
  return act((ctx) => laundry.updateHouseDetails(ctx, input));
}

export async function updateMemberGroupAction(input: {
  houseId: string;
  uid: string;
  group: string;
}) {
  return act((ctx) => laundry.updateMemberGroup(ctx, input));
}

export async function removeMemberAction(input: { houseId: string; uid: string }) {
  return act((ctx) => laundry.removeMember(ctx, input));
}

export async function regenerateInviteCodeAction(input: { houseId: string }) {
  return act((ctx) => laundry.regenerateInviteCode(ctx, input));
}
