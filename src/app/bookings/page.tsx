"use client";

import { IconCalendar, IconCalendarPlus, IconLock, IconWind } from "@tabler/icons-react";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BookingList } from "@/components/booking-list";
import { useHouse } from "@/components/providers/house-provider";
import { RequireHouse } from "@/components/require-house";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMachines, useUpcomingBookings } from "@/hooks/use-house-data";
import { useNow } from "@/hooks/use-now";
import { errorMessage } from "@/lib/errors";
import { runAction } from "@/lib/run-action";
import { proposeDryerSlot, type FollowUpProposal } from "@/lib/follow-up";
import { cn } from "@/lib/utils";
import { cyclesOf, maxMinutesOf } from "@/lib/types";
import { dayAccess, dayLabel } from "@/lib/schedule";
import { createBookingAction } from "@/server/actions";
import {
  MAX_BOOKING_MINUTES,
  SLOT_MINUTES,
  addMinutes,
  atTime,
  formatDayAndTime,
  formatMinutes,
  formatSlotLabel,
  formatTime,
  roundUpToSlot,
  sameDay,
  slotTimeOptions,
  slotValue,
  snapToSlot,
  startOfDay,
} from "@/lib/time";

const TIME_OPTIONS = slotTimeOptions();

export default function BookingsPage() {
  return (
    <RequireHouse>
      <Bookings />
    </RequireHouse>
  );
}

function Bookings() {
  const { houseId, house, member } = useHouse();
  const machines = useMachines();
  const bookings = useUpcomingBookings();
  const now = useNow(60_000);

  const [chosenMachineId, setMachineId] = useState<string>("");
  const [date, setDate] = useState<Date>(() => startOfDay(new Date()));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [chosenStart, setStart] = useState<string>(() => {
    const next = snapToSlot(addMinutes(new Date(), 15));
    return sameDay(next, new Date()) ? slotValue(next) : "08:00";
  });
  const [chosenMinutes, setMinutes] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpProposal | null>(null);

  // On today's date only future slots can be picked; the list shrinks as the day goes on.
  // If the chosen time has slipped into the past, the first available one stands in.
  const startOptions = useMemo(
    () => TIME_OPTIONS.filter((t) => atTime(date, t).getTime() > now),
    [date, now],
  );
  const start = startOptions.includes(chosenStart)
    ? chosenStart
    : (startOptions[0] ?? chosenStart);
  // Fall back to the first machine until one is picked (or if the pick was removed).
  const machineId = machines.data.some((m) => m.id === chosenMachineId)
    ? chosenMachineId
    : (machines.data[0]?.id ?? "");
  const machine = machines.data.find((m) => m.id === machineId) ?? null;

  const dayBookings = useMemo(
    () =>
      bookings.data.filter(
        (b) => b.machineId === machineId && sameDay(b.startAt.toDate(), date),
      ),
    [bookings.data, machineId, date],
  );

  const access = dayAccess(house, member, date);
  const owner = access.owner;
  const otherGroupsDay = access.mode === "soft" && !access.isOwnDay;

  // Same choice as the Start dialog: the machine's own cycles, or a custom length. The
  // booking itself must land on the 15-minute grid, so an 80-minute dry books 90.
  const cycles = machine ? cyclesOf(machine) : [];
  const longest = machine
    ? Math.min(maxMinutesOf(machine), MAX_BOOKING_MINUTES)
    : MAX_BOOKING_MINUTES;
  const usingCustom = custom !== "";
  const requested = usingCustom
    ? Number(custom)
    : (chosenMinutes ?? cycles[Math.floor((cycles.length - 1) / 2)]?.minutes ?? 60);
  const durationMinutes = Number.isFinite(requested) ? roundUpToSlot(requested) : 0;

  const startDate = atTime(date, start);
  const endDate = addMinutes(startDate, durationMinutes);
  const valid =
    durationMinutes >= SLOT_MINUTES &&
    durationMinutes <= longest &&
    endDate.getTime() > now;

  async function book(event: React.FormEvent) {
    event.preventDefault();
    if (!houseId || !member || !machine) return;
    setBusy(true);
    try {
      await runAction(() =>
        createBookingAction({
          houseId,
          machineId: machine.id,
          startMs: startDate.getTime(),
          endMs: endDate.getTime(),
        }),
      );
      toast.success(
        `${machine.name} booked for ${format(date, "EEE d MMM")} ${formatSlotLabel(start)} to ${formatTime(endDate)}.`,
      );

      // Most washes are followed by a dry, so offer the slot instead of making someone
      // work out when the washer frees up. It stays a separate, ordinary booking.
      if (machine.type === "washer") {
        const dryers = machines.data.filter((m) => m.type === "dryer");
        const proposal = proposeDryerSlot({
          washEndsAt: endDate,
          dryers,
          bookings: bookings.data,
        });
        if (proposal && dayAccess(house, member, proposal.start).allowed) {
          setFollowUp(proposal);
        }
      }
    } catch (error) {
      toast.error(errorMessage(error, "Could not make that booking."));
    } finally {
      setBusy(false);
    }
  }

  const today = startOfDay(new Date(now));

  // Everything you have booked from now on, any machine, any day. The day panel above
  // only shows one machine on one date, so without this a slot next week is invisible.
  const myBookings = bookings.data
    .filter((b) => b.uid === member?.uid && b.endAt.toMillis() > now)
    .sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis());

  return (
    <div className="space-y-4">
      {machines.loading ? (
        <Skeleton className="h-10 w-full" />
      ) : machines.data.length > 1 ? (
        <Tabs value={machineId} onValueChange={setMachineId}>
          <TabsList className="w-full">
            {machines.data.map((m) => (
              <TabsTrigger key={m.id} value={m.id} className="flex-1">
                {m.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-start">
        {/* Phones: a popover; wider screens: the calendar stays visible. */}
        <div className="md:hidden">
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="lg" className="w-full justify-start">
                <IconCalendar />
                {format(date, "EEEE d MMMM")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                disabled={{ before: today }}
                onSelect={(next) => {
                  if (next) {
                    setDate(startOfDay(next));
                    setCalendarOpen(false);
                  }
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
        <Card className="hidden md:block">
          <CardContent className="p-2">
            <Calendar
              mode="single"
              selected={date}
              disabled={{ before: today }}
              onSelect={(next) => next && setDate(startOfDay(next))}
            />
          </CardContent>
        </Card>

        <div className="space-y-3">
          {!access.allowed && (
            <Alert variant="destructive">
              <IconLock />
              <AlertTitle>
                {dayLabel(date)} is {owner} day
              </AlertTitle>
              <AlertDescription>
                The schedule is strict: only {owner} can book this day. Pick one of your
                group&apos;s days, or an open day.
              </AlertDescription>
            </Alert>
          )}

          <Card size="sm" className="gap-3">
            <CardHeader className="flex flex-row items-baseline justify-between gap-2">
              <CardTitle className="text-sm">
                {sameDay(date, today) ? "Today" : format(date, "EEEE d MMM")}
              </CardTitle>
              {machine && (
                <span className="text-muted-foreground text-xs">{machine.name}</span>
              )}
            </CardHeader>

            <CardContent className="space-y-3">
              {bookings.loading ? (
                <Skeleton className="h-8 w-full" />
              ) : (
                <BookingList
                  bookings={dayBookings}
                  machines={machines.data}
                  showMachine={false}
                  compact
                  emptyLabel="Nothing booked. The whole day is open."
                />
              )}

              {otherGroupsDay && (
                <p className="text-muted-foreground text-xs">
                  {dayLabel(date)} is {owner} day, so expect them to have first claim. You
                  can still book it.
                </p>
              )}

              <form className="space-y-3 border-t pt-3" onSubmit={book}>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="booking-start" className="text-xs">
                      From
                    </Label>
                    <Select value={start} onValueChange={setStart}>
                      <SelectTrigger id="booking-start" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {startOptions.length === 0 && (
                          <SelectItem value={start} disabled>
                            No slots left today
                          </SelectItem>
                        )}
                        {startOptions.map((t) => (
                          <SelectItem key={t} value={t}>
                            {formatSlotLabel(t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="booking-custom" className="text-xs">
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

                <div className="grid grid-cols-3 gap-2">
                  {cycles.map((cycle) => {
                    const selected = !usingCustom && requested === cycle.minutes;
                    return (
                      <Button
                        key={cycle.name}
                        type="button"
                        variant={selected ? "default" : "outline"}
                        aria-pressed={selected}
                        className="h-12 flex-col gap-0"
                        onClick={() => {
                          setMinutes(cycle.minutes);
                          setCustom("");
                        }}
                      >
                        <span className="text-sm">{cycle.name}</span>
                        <span
                          className={cn(
                            "text-[11px] font-normal",
                            !selected && "text-muted-foreground",
                          )}
                        >
                          {formatMinutes(cycle.minutes)}
                        </span>
                      </Button>
                    );
                  })}
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="h-11 w-full"
                  disabled={busy || !valid || !machine || !access.allowed}
                >
                  <IconCalendarPlus />
                  {valid
                    ? `Book ${formatSlotLabel(start)} to ${formatTime(endDate)}`
                    : `Choose ${SLOT_MINUTES} to ${longest} minutes`}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card size="sm" className="gap-2">
            <CardHeader className="flex flex-row items-baseline justify-between gap-2">
              <CardTitle className="text-sm">Your bookings</CardTitle>
              {myBookings.length > 0 && (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {myBookings.length} upcoming
                </span>
              )}
            </CardHeader>
            <CardContent>
              {bookings.loading ? (
                <Skeleton className="h-8 w-full" />
              ) : (
                <BookingList
                  bookings={myBookings}
                  machines={machines.data}
                  emptyLabel="Nothing booked. Pick a time above."
                  onSelect={(booking) => {
                    setMachineId(booking.machineId);
                    setDate(startOfDay(booking.startAt.toDate()));
                  }}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <DryAfterDialog
        proposal={followUp}
        onOpenChange={(open) => !open && setFollowUp(null)}
      />
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
