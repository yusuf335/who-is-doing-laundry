import { SLOT_MINUTES, addMinutes, snapToSlot } from "@/lib/time";
import { cyclesOf, type Booking, type Machine } from "@/lib/types";

/** A dryer slot to offer right after a wash. */
export interface FollowUpProposal {
  machine: Machine;
  start: Date;
  end: Date;
  minutes: number;
  /** True when the slot straight after the wash was taken and this one is later. */
  delayed: boolean;
}

/** Rounds up to the next bookable boundary, so a proposal always sits on the grid. */
function snapUp(date: Date): Date {
  const floored = snapToSlot(date);
  return floored.getTime() === date.getTime()
    ? floored
    : addMinutes(floored, SLOT_MINUTES);
}

/** The cycle a dryer is most likely to run: its "Normal" preset, else the middle one. */
function defaultMinutes(machine: Machine): number {
  const cycles = cyclesOf(machine);
  const normal = cycles.find((c) => c.name.trim().toLowerCase() === "normal");
  return (normal ?? cycles[Math.floor((cycles.length - 1) / 2)])?.minutes ?? 60;
}

function overlaps(booking: Booking, start: Date, end: Date): boolean {
  return (
    booking.startAt.toMillis() < end.getTime() &&
    booking.endAt.toMillis() > start.getTime()
  );
}

/**
 * Finds the first free window on a dryer once the wash is done, so the app can offer to
 * book it rather than making anyone do the arithmetic. Bookings stay independent: this
 * proposes a second, ordinary booking, it does not chain the two machines together.
 *
 * Returns null when nothing sensible is available, in which case no prompt is shown.
 */
export function proposeDryerSlot(input: {
  washEndsAt: Date;
  dryers: Machine[];
  /** Every upcoming booking in the house; filtered per machine here. */
  bookings: Booking[];
  /** How far past the wash to look before giving up. */
  searchHours?: number;
}): FollowUpProposal | null {
  const { washEndsAt, dryers, bookings } = input;
  const limit = addMinutes(washEndsAt, (input.searchHours ?? 12) * 60);
  const earliest = snapUp(washEndsAt);

  let best: FollowUpProposal | null = null;

  for (const machine of dryers) {
    const minutes = defaultMinutes(machine);
    const taken = bookings
      .filter((b) => b.machineId === machine.id)
      .sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis());

    let start = earliest;
    // Each clash pushes the window to just after the booking in the way, so this walks
    // forward a booking at a time rather than a slot at a time.
    for (let guard = 0; guard < 50; guard++) {
      const end = addMinutes(start, minutes);
      if (start.getTime() > limit.getTime()) break;

      const clash = taken.find((b) => overlaps(b, start, end));
      if (!clash) {
        if (!best || start.getTime() < best.start.getTime()) {
          best = {
            machine,
            start,
            end,
            minutes,
            delayed: start.getTime() !== earliest.getTime(),
          };
        }
        break;
      }
      start = snapUp(clash.endAt.toDate());
    }
  }

  return best;
}
