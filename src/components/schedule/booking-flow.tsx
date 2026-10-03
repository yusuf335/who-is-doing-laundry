"use client";

import { IconCalendar, IconCalendarPlus, IconTrash, IconWind } from "@tabler/icons-react";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import { useHouse } from "@/components/providers/house-provider";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { errorMessage } from "@/lib/errors";
import { proposeDryerSlot, type FollowUpProposal } from "@/lib/follow-up";
import { textOn } from "@/lib/machine-color";
import { runAction } from "@/lib/run-action";
import { dayAccess, dayLabel } from "@/lib/schedule";
import {
  MAX_BOOKING_MINUTES,
  MAX_DAYS_AHEAD,
  SLOT_MINUTES,
  addDays,
  addMinutes,
  formatDayAndTime,
  formatDuration,
  formatMinutes,
  formatTime,
  latestBookingStart,
  roundUpToSlot,
  sameDay,
  startOfDay,
} from "@/lib/time";
import { cyclesOf, machineState, maxMinutesOf, type Machine } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  firstOverlap,
  nextBookingAfter,
  nextFreeSlot,
  validStarts,
  type CalendarBooking,
} from "@/lib/week";
import { cancelBookingAction, createBookingAction } from "@/server/actions";

export type FlowState =
  | { step: "choose" }
  | { step: "book"; machineId: string; start: Date }
  | { step: "details"; bookingId: string }
  | null;

/** The cycle someone most likely wants: the middle preset. */
function defaultCycle(machine: Machine) {
  const cycles = cyclesOf(machine);
  return cycles[Math.floor((cycles.length - 1) / 2)] ?? { name: "", minutes: 60 };
}

/** That cycle's length on the booking grid. */
function defaultMinutes(machine: Machine): number {
  return roundUpToSlot(defaultCycle(machine).minutes);
}

/** Bottom sheet on a phone, centred dialog on a desktop. */
function Surface({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92svh] gap-3 overflow-y-auto rounded-t-2xl px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <span
          aria-hidden
          className="bg-muted-foreground/30 mx-auto h-1 w-10 rounded-full"
        />
        <SheetHeader className="p-0 pr-10 text-left">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Everything that opens from the calendar: picking a machine, booking a slot, and
 * looking at (or cancelling) a booking. One surface, so only one is ever open.
 */
export function BookingFlow({
  state,
  onStateChange,
  machines,
  colors,
  bookings,
  now,
}: {
  state: FlowState;
  onStateChange: (state: FlowState) => void;
  machines: Machine[];
  colors: Record<string, string>;
  bookings: CalendarBooking[];
  now: number;
}) {
  const [followUp, setFollowUp] = useState<FollowUpProposal | null>(null);
  const close = () => onStateChange(null);

  const machine =
    state?.step === "book"
      ? (machines.find((m) => m.id === state.machineId) ?? null)
      : null;
  const booking =
    state?.step === "details"
      ? (bookings.find((b) => b.id === state.bookingId) ?? null)
      : null;

  return (
    <>
      <Surface
        open={state?.step === "choose"}
        onOpenChange={(open) => !open && close()}
        title="Which machine?"
        description="You can change the time next."
      >
        <ChooseMachine
          machines={machines}
          colors={colors}
          bookings={bookings}
          now={now}
          onPick={(m, start) => onStateChange({ step: "book", machineId: m.id, start })}
        />
      </Surface>

      <Surface
        open={machine !== null}
        onOpenChange={(open) => !open && close()}
        title={machine ? `Book ${machine.name}` : "Book"}
      >
        {machine && state?.step === "book" && (
          <BookForm
            // A new pick starts the form afresh rather than keeping the last one's edits.
            key={`${machine.id}|${state.start.getTime()}`}
            machine={machine}
            machines={machines}
            color={colors[machine.id]}
            initialStart={state.start}
            bookings={bookings}
            now={now}
            onChangeMachine={() => onStateChange({ step: "choose" })}
            onBooked={(proposal) => {
              close();
              setFollowUp(proposal);
            }}
          />
        )}
      </Surface>

      <Surface
        // A booking cancelled elsewhere while this is open just closes it.
        open={booking !== null}
        onOpenChange={(open) => !open && close()}
        title={booking ? "Booking" : ""}
      >
        {booking && (
          <BookingDetails
            booking={booking}
            machine={machines.find((m) => m.id === booking.machineId) ?? null}
            color={colors[booking.machineId] ?? "#737373"}
            now={now}
            onDone={close}
          />
        )}
      </Surface>

      <DryAfterDialog
        proposal={followUp}
        onOpenChange={(open) => !open && setFollowUp(null)}
      />
    </>
  );
}

function ChooseMachine({
  machines,
  colors,
  bookings,
  now,
  onPick,
}: {
  machines: Machine[];
  colors: Record<string, string>;
  bookings: CalendarBooking[];
  now: number;
  onPick: (machine: Machine, start: Date) => void;
}) {
  const { house, member } = useHouse();

  if (machines.length === 0) {
    return <p className="text-muted-foreground text-sm">No machines to book yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {machines.map((m) => {
        const next = nextFreeSlot(
          bookings,
          m.id,
          now,
          defaultMinutes(m),
          14,
          (day) => dayAccess(house, member, day).allowed,
        );
        const state = machineState(m, now);
        const session = m.currentSession;
        const status =
          state === "free"
            ? "Available now"
            : state === "running" && session
              ? `In use until ${formatTime(session.expectedEndAt.toDate())}`
              : "Finished, waiting to be emptied";
        return (
          <li key={m.id}>
            <button
              type="button"
              disabled={!next}
              onClick={() => next && onPick(m, next)}
              className="hover:bg-muted/60 focus-visible:ring-ring flex min-h-16 w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            >
              <span
                className="size-4 shrink-0 rounded-[5px]"
                style={{ backgroundColor: colors[m.id] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold">{m.name}</span>
                <span
                  className={cn(
                    "block text-xs",
                    state === "free" && "text-emerald-700 dark:text-emerald-400",
                    state === "running" && "text-red-700 dark:text-red-400",
                    state === "finished" && "text-amber-700 dark:text-amber-400",
                  )}
                >
                  {status}
                </span>
              </span>
              <span className="text-muted-foreground shrink-0 text-right text-[11px]">
                Next free
                <span className="text-foreground block text-sm font-semibold tabular-nums">
                  {next ? formatDayAndTime(next, new Date(now)) : "Nothing soon"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function BookForm({
  machine,
  machines,
  color,
  initialStart,
  bookings,
  now,
  onChangeMachine,
  onBooked,
}: {
  machine: Machine;
  machines: Machine[];
  color: string;
  initialStart: Date;
  bookings: CalendarBooking[];
  now: number;
  onChangeMachine: () => void;
  onBooked: (followUp: FollowUpProposal | null) => void;
}) {
  const { houseId, house, member } = useHouse();
  const [chosen, setChosen] = useState(initialStart);
  // By name, so two presets that round to the same quarter hour are not both selected.
  const [cycleName, setCycleName] = useState(() => defaultCycle(machine).name);
  const [dayOpen, setDayOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const today = startOfDay(new Date(now));
  const cycles = cyclesOf(machine);
  const longest = Math.min(maxMinutesOf(machine), MAX_BOOKING_MINUTES);
  const usingCustom = custom !== "";
  const cycle = cycles.find((c) => c.name === cycleName) ?? defaultCycle(machine);
  const requested = usingCustom ? Number(custom) : cycle.minutes;
  const minutes = Number.isFinite(requested) ? roundUpToSlot(requested) : 0;
  const lengthOk = minutes >= SLOT_MINUTES && minutes <= longest;

  // Only starts that are bookable at all: the member's day, in the future, and free for
  // the whole cycle. The browser's picker cannot grey out taken times, so whatever is
  // typed is checked against these, and the nearest one is offered when it misses.
  const timesFor = (day: Date): Date[] =>
    lengthOk && dayAccess(house, member, day).allowed
      ? validStarts(bookings, machine.id, day, now, minutes)
      : [];

  const valid = timesFor(chosen).some((t) => t.getTime() === chosen.getTime());

  // Every quarter hour of the chosen day still ahead, the unusable ones marked and greyed.
  const dayTimes = timesFor(chosen).map((t) => t.getTime());
  const dayAllowed = dayAccess(house, member, chosen).allowed;
  const seen = new Set<number>();
  const timeOptions = Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, i) => {
    const time = startOfDay(chosen);
    time.setHours(0, i * SLOT_MINUTES, 0, 0);
    return time;
  })
    // Times already gone are left out, except the current pick so the select can show it.
    // A DST change can map two grid points to one moment; keep it once.
    .filter((time) => {
      const ms = time.getTime();
      if (seen.has(ms) || (ms < now && ms !== chosen.getTime())) return false;
      seen.add(ms);
      return true;
    })
    .map((time) => {
      if (dayTimes.includes(time.getTime())) return { time, note: null };
      if (time.getTime() < now) return { time, note: "passed" };
      if (time.getTime() > latestBookingStart(now)) return { time, note: "not open yet" };
      if (!dayAllowed) return { time, note: "not your day" };
      const taken = bookings.some(
        (b) =>
          b.machineId === machine.id &&
          b.startAt.toMillis() <= time.getTime() &&
          b.endAt.toMillis() > time.getTime(),
      );
      return { time, note: taken ? "booked" : "too short a gap" };
    });

  const start = valid ? chosen : null;
  const end = start ? addMinutes(start, minutes) : null;
  const access = dayAccess(house, member, chosen);
  const next = end ? nextBookingAfter(bookings, machine.id, end) : null;
  const canBook = start !== null && end !== null;

  // When the pick does not work: the next time that does, that day or the next fortnight.
  let suggestion: Date | null = null;
  if (!valid && lengthOk) {
    suggestion = timesFor(chosen).find((t) => t > chosen) ?? null;
    for (let i = 1; !suggestion && i <= 14; i++) {
      suggestion = timesFor(addDays(startOfDay(chosen), i))[0] ?? null;
    }
  }

  let message: { tone: "ok" | "bad"; text: string };
  if (!lengthOk)
    message = { tone: "bad", text: `Choose ${SLOT_MINUTES} to ${longest} minutes.` };
  else if (chosen.getTime() < now)
    message = { tone: "bad", text: "That time has already passed." };
  else if (chosen.getTime() > latestBookingStart(now))
    message = {
      tone: "bad",
      text: `Bookings open up to ${MAX_DAYS_AHEAD / 7} weeks ahead.`,
    };
  else if (!access.allowed)
    message = { tone: "bad", text: access.reason ?? "Not your day." };
  else if (!start) {
    const clash = firstOverlap(bookings, machine.id, chosen, addMinutes(chosen, minutes));
    const who = clash
      ? clash.uid === member?.uid
        ? "your booking"
        : clash.displayName
      : null;
    message = {
      tone: "bad",
      text: clash
        ? `A ${formatMinutes(minutes)} cycle then overlaps ${who}, ${formatTime(clash.startAt.toDate())} to ${formatTime(clash.endAt.toDate())}.`
        : "Bookings start on the quarter hour.",
    };
  } else {
    message = {
      tone: "ok",
      text:
        next && sameDay(next.startAt.toDate(), start)
          ? `Fits. Free until ${formatTime(next.startAt.toDate())}.`
          : "Fits. Nothing else booked after it that day.",
    };
  }

  async function book() {
    if (!houseId || !start || !end) return;
    setBusy(true);
    try {
      await runAction(() =>
        createBookingAction({
          houseId,
          machineId: machine.id,
          startMs: start.getTime(),
          endMs: end.getTime(),
        }),
      );
      toast.success(
        `${machine.name} booked for ${format(start, "EEE d MMM")}, ${formatTime(start)} to ${formatTime(end)}.`,
      );
      // Most washes are followed by a dry, so offer the slot instead of making someone
      // work out when the washer frees up. It stays a separate, ordinary booking.
      let proposal: FollowUpProposal | null = null;
      if (machine.type === "washer") {
        proposal = proposeDryerSlot({
          washEndsAt: end,
          dryers: machines.filter((m) => m.type === "dryer"),
          bookings,
        });
        if (proposal && !dayAccess(house, member, proposal.start).allowed)
          proposal = null;
      }
      onBooked(proposal);
    } catch (error) {
      toast.error(errorMessage(error, "Could not make that booking."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <span
          className="size-4 shrink-0 rounded-[5px]"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{machine.name}</p>
        <Button variant="outline" size="sm" className="h-9" onClick={onChangeMachine}>
          Change
        </Button>
      </div>

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs font-medium">How long</p>
        <div
          className={cn("grid gap-2", cycles.length <= 3 ? "grid-cols-3" : "grid-cols-2")}
        >
          {cycles.map((preset) => {
            const selected = !usingCustom && cycleName === preset.name;
            return (
              <Button
                key={preset.name}
                type="button"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                className="h-14 flex-col gap-0"
                onClick={() => {
                  setCycleName(preset.name);
                  setCustom("");
                }}
              >
                <span className="text-sm">{preset.name}</span>
                <span
                  className={cn(
                    "text-[11px] font-normal",
                    !selected && "text-muted-foreground",
                  )}
                >
                  {formatMinutes(preset.minutes)}
                </span>
              </Button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Label
            htmlFor="booking-custom"
            className="text-muted-foreground shrink-0 text-xs"
          >
            Or minutes
          </Label>
          <Input
            id="booking-custom"
            type="number"
            inputMode="numeric"
            min={SLOT_MINUTES}
            max={longest}
            placeholder={`up to ${longest}`}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="booking-when" className="text-muted-foreground text-xs">
          When
        </Label>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Popover modal open={dayOpen} onOpenChange={setDayOpen}>
            <PopoverTrigger asChild>
              <Button
                id="booking-when"
                variant="outline"
                className="h-12 justify-start gap-2.5 text-base font-medium"
              >
                <IconCalendar className="text-muted-foreground size-5" />
                {sameDay(chosen, today) ? "Today" : format(chosen, "EEE d MMM")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
              <Calendar
                mode="single"
                selected={chosen}
                defaultMonth={chosen}
                // Greyed: days gone, other groups' strict days, and days with no room.
                disabled={(day) => day < today || timesFor(day).length === 0}
                onSelect={(day) => {
                  if (!day) return;
                  const next = new Date(day);
                  next.setHours(chosen.getHours(), chosen.getMinutes(), 0, 0);
                  setChosen(next);
                  setDayOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>

          <Select
            value={String(chosen.getTime())}
            onValueChange={(v) => setChosen(new Date(Number(v)))}
          >
            <SelectTrigger
              aria-label="Start time"
              className="h-12! w-36 text-base tabular-nums"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              {timeOptions.map((option) => (
                <SelectItem
                  key={option.time.getTime()}
                  value={String(option.time.getTime())}
                  // Greyed out and unpickable: booked, too short a gap, or gone.
                  disabled={option.note !== null}
                  className="tabular-nums"
                >
                  {formatTime(option.time)}
                  {option.note && (
                    <span className="text-muted-foreground text-xs">{option.note}</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p
        role="status"
        className={cn(
          "rounded-lg px-3 py-2.5 text-sm",
          message.tone === "ok"
            ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
            : "bg-red-500/10 text-red-800 dark:text-red-300",
        )}
      >
        {message.text}
        {suggestion && (
          <Button
            variant="link"
            className="ml-1 h-auto p-0 text-sm font-semibold text-inherit underline"
            onClick={() => setChosen(suggestion)}
          >
            Use{" "}
            {sameDay(suggestion, chosen) ? "" : `${format(suggestion, "EEE d MMM")}, `}
            {formatTime(suggestion)}
          </Button>
        )}
      </p>
      {canBook && access.mode === "soft" && !access.isOwnDay && access.owner && (
        <p className="text-muted-foreground -mt-2 text-xs">
          {dayLabel(chosen)} is {access.owner} day, so expect them to have first claim.
          You can still book it.
        </p>
      )}

      <Button
        size="lg"
        className="h-12 w-full text-base"
        disabled={busy || !canBook}
        onClick={book}
      >
        <IconCalendarPlus />
        {start && end
          ? `Book ${formatTime(start)} to ${formatTime(end)}`
          : "Can't book this time"}
      </Button>
    </div>
  );
}

function BookingDetails({
  booking,
  machine,
  color,
  now,
  onDone,
}: {
  booking: CalendarBooking;
  machine: Machine | null;
  color: string;
  now: number;
  onDone: () => void;
}) {
  const { houseId, member, isAdmin } = useHouse();
  const [busy, setBusy] = useState(false);
  const mine = booking.uid === member?.uid;
  const start = booking.startAt.toDate();
  const end = booking.endAt.toDate();
  const over = booking.endAt.toMillis() <= now;
  const who = mine ? "You" : booking.displayName;
  // A running cycle, not a booking: nothing to cancel here, it is ended on the machine.
  const running = booking.inUse === true;

  async function cancel() {
    if (!houseId) return;
    setBusy(true);
    try {
      await runAction(() => cancelBookingAction({ houseId, bookingId: booking.id }));
      toast.success("Booking cancelled.");
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, "Could not cancel that booking."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={
            mine
              ? { backgroundColor: color, color: textOn(color) }
              : { backgroundColor: `color-mix(in oklab, ${color} 20%, var(--card))` }
          }
          aria-hidden
        >
          {who.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{who}</p>
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <span
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            {machine?.name ?? "Removed machine"}
          </p>
        </div>
      </div>

      <div className="bg-muted/60 space-y-0.5 rounded-xl p-3">
        <p className="text-muted-foreground text-sm">{format(start, "EEEE d MMMM")}</p>
        <p className="text-lg font-semibold tabular-nums">
          {formatTime(start)} to {formatTime(end)}
        </p>
        <p className="text-muted-foreground text-sm">
          {running
            ? "Running now. It is ended from the machine, not here."
            : formatMinutes(Math.round((end.getTime() - start.getTime()) / 60_000))}
          {!over &&
            start.getTime() > now &&
            ` · starts in ${formatDuration(start.getTime() - now)}`}
        </p>
      </div>

      {!running && !mine && !isAdmin && !over && (
        <p className="text-muted-foreground text-sm">
          Only {booking.displayName} or the house admin can cancel this.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" size="lg" className="h-11" onClick={onDone}>
          Done
        </Button>
        {!running && (mine || isAdmin) && !over && (
          <Button
            variant="outline"
            size="lg"
            className="text-destructive h-11"
            disabled={busy}
            onClick={cancel}
          >
            <IconTrash />
            Cancel booking
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Offered straight after a wash is booked. Booking it creates a second, ordinary booking
 * on the dryer; declining leaves the wash exactly as it was.
 */
function DryAfterDialog({
  proposal,
  onOpenChange,
}: {
  proposal: FollowUpProposal | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { houseId } = useHouse();
  const [busy, setBusy] = useState(false);

  async function book() {
    if (!houseId || !proposal) return;
    setBusy(true);
    try {
      await runAction(() =>
        createBookingAction({
          houseId,
          machineId: proposal.machine.id,
          startMs: proposal.start.getTime(),
          endMs: proposal.end.getTime(),
        }),
      );
      toast.success(
        `${proposal.machine.name} booked for ${formatTime(proposal.start)} to ${formatTime(proposal.end)}.`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Could not book the dryer."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={proposal !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {proposal && (
          <>
            <DialogHeader>
              <DialogTitle>Dry afterwards?</DialogTitle>
              <DialogDescription>
                {proposal.delayed
                  ? `${proposal.machine.name} is busy when your wash ends, so this is its next open slot.`
                  : `${proposal.machine.name} is available as soon as your wash finishes.`}
              </DialogDescription>
            </DialogHeader>

            <div className="bg-muted/60 flex items-center gap-3 rounded-lg px-3 py-2.5">
              <IconWind className="text-muted-foreground size-5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{proposal.machine.name}</p>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {formatDayAndTime(proposal.start)} to {formatTime(proposal.end)} ·{" "}
                  {formatMinutes(proposal.minutes)}
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                className="h-11"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                No thanks
              </Button>
              <Button className="h-11" disabled={busy} onClick={book}>
                <IconCalendarPlus />
                Book the dryer
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
