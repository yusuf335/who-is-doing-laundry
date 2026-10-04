"use client";

import {
  IconCheck,
  IconCircleCheck,
  IconHourglass,
  IconLock,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconWashMachine,
  IconWind,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { useHouse } from "@/components/providers/house-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { dayAccess } from "@/lib/schedule";
import { runAction } from "@/lib/run-action";
import { textOn } from "@/lib/machine-color";
import {
  formatDuration,
  formatMinutes,
  formatTime,
  roundUpToSlot,
  sameDay,
} from "@/lib/time";
import {
  cyclesOf,
  machineState,
  maxMinutesOf,
  NO_SHOW_MINUTES,
  type Booking,
  type Machine,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { endSessionAction, startSessionAction } from "@/server/actions";

/** Why this member cannot start `machine` right now, or null when they can. */
function startBlockReason(
  access: ReturnType<typeof dayAccess>,
  bookedNow: Booking | null,
): string | null {
  if (!access.allowed) return access.reason;
  if (bookedNow) {
    return `Booked by ${bookedNow.displayName} until ${formatTime(bookedNow.endAt.toDate())}.`;
  }
  return null;
}

/** Someone else's booking that covers this moment: starting now would take their slot. */
function bookedNowBy(
  machine: Machine,
  bookings: Booking[],
  uid: string | undefined,
  now: number,
): Booking | null {
  return (
    bookings.find(
      (b) =>
        b.machineId === machine.id &&
        b.uid !== uid &&
        b.startAt.toMillis() <= now &&
        b.endAt.toMillis() > now,
    ) ?? null
  );
}

/**
 * Your own booking for this machine that you can start now: from 15 minutes before it
 * begins (the same window that checks it in) until it ends.
 */
function myBookingNow(
  machine: Machine,
  bookings: Booking[],
  uid: string | undefined,
  now: number,
): Booking | null {
  if (!uid) return null;
  return (
    bookings.find(
      (b) =>
        b.machineId === machine.id &&
        b.uid === uid &&
        !b.checkedInAt &&
        b.startAt.toMillis() - NO_SHOW_MINUTES * 60_000 <= now &&
        b.endAt.toMillis() > now,
    ) ?? null
  );
}

/**
 * The cycle a booking was made for. Bookings are kept in whole quarter hours, so a
 * 40-minute "Normal" was booked as 45: the preset that rounds up to the booking's length
 * is the real one. With none (a custom length), the booking's own length.
 */
function cycleForBooking(
  machine: Machine,
  booking: Booking,
): { name: string | null; minutes: number } {
  const booked = Math.round(
    (booking.endAt.toMillis() - booking.startAt.toMillis()) / 60_000,
  );
  const preset = cyclesOf(machine)
    .filter((c) => roundUpToSlot(c.minutes) === booked)
    .sort((a, b) => b.minutes - a.minutes)[0];
  if (preset) return { name: preset.name, minutes: preset.minutes };
  return { name: null, minutes: Math.max(1, Math.min(booked, maxMinutesOf(machine))) };
}

/**
 * The one button a machine needs right now: Start when it is free, Done for your own
 * cycle, Stop for someone else's (only once it has finished, or for the admin), and
 * Emptied when the cycle is over. Shared by the phone cards and the desktop sidebar.
 */
export function MachineAction({
  machine,
  bookings,
  now,
  className,
}: {
  machine: Machine;
  bookings: Booking[];
  now: number;
  className?: string;
}) {
  const { houseId, house, member, isAdmin } = useHouse();
  const [startOpen, setStartOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const state = machineState(machine, now);
  const session = machine.currentSession;
  const mine = session?.uid === member?.uid;
  const canEnd = state === "finished" || mine || isAdmin;

  // Strict schedule: the server refuses too; this just explains it before the tap.
  const startReason = startBlockReason(
    dayAccess(house, member, new Date(now)),
    bookedNowBy(machine, bookings, member?.uid, now),
  );

  // Your booking already says which cycle, so Start just starts it.
  const booking = myBookingNow(machine, bookings, member?.uid, now);

  async function startBooked(booked: Booking) {
    if (!houseId || !member) return;
    const cycle = cycleForBooking(machine, booked);
    setBusy(true);
    try {
      await runAction(() =>
        startSessionAction({ houseId, machineId: machine.id, minutes: cycle.minutes }),
      );
      toast.success(
        `${machine.name} started: ${cycle.name ? `${cycle.name}, ` : ""}${formatMinutes(cycle.minutes)}.`,
      );
    } catch (error) {
      // Started late and the full cycle would run into the next booking, say: let them
      // pick a shorter one.
      toast.error(errorMessage(error, "Could not start the machine."));
      setStartOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!houseId || !member) return;
    setBusy(true);
    try {
      await runAction(() => endSessionAction({ houseId, machineId: machine.id }));
      toast.success(`${machine.name} is available again.`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not finish the cycle."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {state === "free" ? (
        <Button
          size="sm"
          className={cn("h-9 shrink-0 px-3", className)}
          disabled={startReason !== null || busy}
          title={startReason ?? undefined}
          onClick={() => (booking ? startBooked(booking) : setStartOpen(true))}
        >
          {startReason ? <IconLock /> : <IconPlayerPlayFilled />}
          Start
        </Button>
      ) : (
        <Button
          size="sm"
          className={cn(
            "h-9 shrink-0 px-3",
            state === "finished" &&
              "bg-amber-500 text-black hover:bg-amber-500/90 dark:bg-amber-400",
            className,
          )}
          variant={state === "finished" || mine ? "default" : "outline"}
          disabled={!canEnd || busy}
          title={
            !canEnd
              ? `Only ${session?.displayName} can stop it before it finishes`
              : undefined
          }
          onClick={finish}
        >
          <IconCheck />
          {state === "finished" ? "Emptied" : mine ? "Done" : "Stop"}
        </Button>
      )}

      <StartDialog
        machine={machine}
        bookings={bookings.filter((b) => b.machineId === machine.id)}
        now={now}
        open={startOpen}
        onOpenChange={setStartOpen}
      />
    </>
  );
}

export function MachineCard({
  machine,
  color,
  bookings,
  now,
}: {
  machine: Machine;
  color: string;
  bookings: Booking[];
  now: number;
}) {
  const { house, member } = useHouse();

  const state = machineState(machine, now);
  const session = machine.currentSession;
  const mine = session?.uid === member?.uid;
  const Icon = machine.type === "dryer" ? IconWind : IconWashMachine;

  // The preset the cycle length matches, so the row can say "Heavy" instead of "60 min".
  const cycleName = session
    ? (cyclesOf(machine).find(
        (c) =>
          c.minutes ===
          Math.round(
            (session.expectedEndAt.toMillis() - session.startedAt.toMillis()) / 60_000,
          ),
      )?.name ?? null)
    : null;

  const progress = session
    ? Math.min(
        1,
        Math.max(
          0,
          (now - session.startedAt.toMillis()) /
            Math.max(1, session.expectedEndAt.toMillis() - session.startedAt.toMillis()),
        ),
      )
    : 0;

  const startReason = startBlockReason(
    dayAccess(house, member, new Date(now)),
    bookedNowBy(machine, bookings, member?.uid, now),
  );

  // While it is free, say how long for: the next booking on it today, if any.
  const nextBooking =
    state === "free"
      ? (bookings
          .filter(
            (b) =>
              b.machineId === machine.id &&
              b.startAt.toMillis() > now &&
              sameDay(b.startAt.toDate(), new Date(now)),
          )
          .sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis())[0] ?? null)
      : null;

  return (
    <Card
      size="sm"
      className={cn(
        "gap-2 border-l-4",
        state === "free" && "border-l-emerald-500",
        state === "running" && "border-l-red-500",
        state === "finished" && "border-l-amber-500",
      )}
    >
      <CardHeader className="flex flex-row items-center gap-2">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: color, color: textOn(color) }}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <CardTitle className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-base leading-tight">
          <span className="truncate">{machine.name}</span>
          <StatusBadge state={state} />
        </CardTitle>
        <MachineAction machine={machine} bookings={bookings} now={now} />
      </CardHeader>

      {state === "free" && (startReason || nextBooking) && (
        <CardContent>
          <p className="text-muted-foreground text-xs">
            {startReason ??
              (nextBooking &&
                `Free until ${formatTime(nextBooking.startAt.toDate())}, then ${
                  nextBooking.uid === member?.uid
                    ? "your booking"
                    : nextBooking.displayName
                }.`)}
          </p>
        </CardContent>
      )}

      {session && state !== "free" && (
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground min-w-0 truncate text-sm">
              <span className="text-foreground font-medium">
                {mine ? "You" : session.displayName}
              </span>
              {cycleName && ` · ${cycleName}`}
              {" · "}
              <span className="tabular-nums">
                {formatTime(session.startedAt.toDate())}–
                {formatTime(session.expectedEndAt.toDate())}
              </span>
              {state === "finished" && (
                <span className="block text-xs text-amber-700 dark:text-amber-400">
                  Finished, waiting to be emptied
                </span>
              )}
            </p>
            <p
              className="shrink-0 font-mono text-lg font-semibold tabular-nums"
              aria-label={state === "running" ? "Time left" : "Overdue by"}
            >
              {state === "finished" && "+"}
              {formatDuration(
                state === "running"
                  ? session.expectedEndAt.toMillis() - now
                  : now - session.expectedEndAt.toMillis(),
              )}
            </p>
          </div>

          {/* How far through the cycle is, read before the numbers are. */}
          <div
            className="bg-muted h-1 overflow-hidden rounded-full"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label={`${machine.name} cycle progress`}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-1000 ease-linear",
                state === "finished" ? "bg-amber-500" : "bg-red-500",
              )}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/** Colour + icon + word, so the state reads in a dim basement and to a screen reader. */
function StatusBadge({ state }: { state: ReturnType<typeof machineState> }) {
  if (state === "free") {
    return (
      <Badge
        role="status"
        className="h-6 bg-emerald-600 px-2.5 text-white dark:bg-emerald-500"
      >
        <IconCircleCheck />
        Available
      </Badge>
    );
  }
  if (state === "running") {
    return (
      <Badge role="status" className="h-5 bg-red-600 px-2 text-white dark:bg-red-500">
        <IconPlayerPlayFilled />
        In use
      </Badge>
    );
  }
  return (
    <Badge
      role="status"
      className="h-6 bg-amber-500 px-2.5 text-white dark:bg-amber-400 dark:text-black"
    >
      <IconHourglass />
      Finished
    </Badge>
  );
}

function StartDialog({
  machine,
  bookings,
  now,
  open,
  onOpenChange,
}: {
  machine: Machine;
  /** Upcoming bookings for this machine only. */
  bookings: Booking[];
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { houseId, member } = useHouse();
  const cycles = cyclesOf(machine);
  const maxMinutes = maxMinutesOf(machine);
  // Middle preset by default: "Normal" for the stock lists.
  const [minutes, setMinutes] = useState<number>(
    () => cycles[Math.floor((cycles.length - 1) / 2)]?.minutes ?? 60,
  );
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const usingCustom = custom !== "";
  const chosen = usingCustom ? Number(custom) : minutes;
  const chosenCycle = usingCustom ? null : cycles.find((c) => c.minutes === minutes);

  // A cycle of this length would end here, so anything booked before then is in the way.
  const wouldEndAt = now + (Number.isFinite(chosen) ? chosen : 0) * 60_000;
  const clash =
    bookings.find(
      (b) =>
        b.uid !== member?.uid &&
        b.startAt.toMillis() < wouldEndAt &&
        b.endAt.toMillis() > now,
    ) ?? null;

  async function start() {
    if (!houseId || !member) return;
    setBusy(true);
    try {
      await runAction(() =>
        startSessionAction({ houseId, machineId: machine.id, minutes: chosen }),
      );
      toast.success(
        `${machine.name} started: ${chosenCycle ? `${chosenCycle.name}, ` : ""}${formatMinutes(chosen)}.`,
      );
      onOpenChange(false);
      setCustom("");
    } catch (error) {
      toast.error(errorMessage(error, "Could not start the machine."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Start {machine.name}</DialogTitle>
          <DialogDescription>
            How long will the cycle take? Your housemates see the countdown, and your name
            stays in the 7-day history.
          </DialogDescription>
        </DialogHeader>

        {clash && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
            <span className="font-medium">
              {clash.startAt.toMillis() <= now ? "Booked right now" : "Booked soon"} by{" "}
              {clash.displayName}
            </span>{" "}
            from {formatTime(clash.startAt.toDate())} to{" "}
            {formatTime(clash.endAt.toDate())}.
            {clash.startAt.toMillis() > now
              ? " Pick a shorter cycle, or wait until their slot is over."
              : " Wait until their slot is over."}
          </p>
        )}

        <div
          className={cn("grid gap-2", cycles.length <= 3 ? "grid-cols-3" : "grid-cols-2")}
        >
          {cycles.map((cycle) => {
            const selected = !usingCustom && minutes === cycle.minutes;
            return (
              <Button
                key={cycle.name}
                type="button"
                size="lg"
                className="h-14 flex-col gap-0 text-base"
                aria-pressed={selected}
                variant={selected ? "default" : "outline"}
                onClick={() => {
                  setMinutes(cycle.minutes);
                  setCustom("");
                }}
              >
                <span>{cycle.name}</span>
                <span
                  className={cn(
                    "text-xs font-normal",
                    !selected && "text-muted-foreground",
                  )}
                >
                  {formatMinutes(cycle.minutes)}
                </span>
              </Button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="custom-minutes">Custom (minutes, up to {maxMinutes})</Label>
          <Input
            id="custom-minutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxMinutes}
            placeholder={`e.g. ${Math.min(120, maxMinutes)}`}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button
            size="lg"
            className="h-12 w-full text-base sm:w-auto"
            onClick={start}
            disabled={
              busy ||
              clash !== null ||
              !Number.isFinite(chosen) ||
              chosen < 1 ||
              chosen > maxMinutes
            }
          >
            <IconPlayerPlay />
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
