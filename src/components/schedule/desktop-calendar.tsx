"use client";

import { IconChevronLeft, IconChevronRight, IconPlus } from "@tabler/icons-react";
import { format } from "date-fns";
import { useCallback, useMemo, useState } from "react";
import { MachineAction } from "@/components/machine-card";
import { useHouse } from "@/components/providers/house-provider";
import { ScheduleBanner } from "@/components/schedule-banner";
import { MyBookings } from "@/components/schedule/my-bookings";
import { Legend } from "@/components/schedule/phone-schedule";
import { TimeGrid } from "@/components/schedule/time-grid";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMembers } from "@/hooks/use-house-data";
import {
  addDays,
  formatDuration,
  formatTime,
  latestBookingStart,
  sameDay,
  startOfDay,
} from "@/lib/time";
import { machineState, type Booking, type Machine } from "@/lib/types";
import { cn } from "@/lib/utils";
import { visibleDays, type CalendarBooking } from "@/lib/week";

type View = "week" | "day";

/**
 * The wide-screen calendar, laid out like Google Calendar: what to show on the left
 * (machines and housemates, ticked like calendars), the time grid on the right.
 */
export function DesktopCalendar({
  machines,
  colors,
  bookings,
  loading,
  now,
  onPickGap,
  onOpenBooking,
  onBook,
}: {
  machines: Machine[];
  colors: Record<string, string>;
  bookings: Booking[];
  loading: boolean;
  /** Ticks every second, for the countdowns in the sidebar. */
  now: number;
  onPickGap: (machine: Machine, start: Date) => void;
  onOpenBooking: (booking: Booking) => void;
  onBook: () => void;
}) {
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [hiddenMachines, setHiddenMachines] = useState<ReadonlySet<string>>(new Set());
  const [hiddenPeople, setHiddenPeople] = useState<ReadonlySet<string>>(new Set());

  const minuteNow = Math.floor(now / 60_000) * 60_000;
  const today = startOfDay(new Date(now));
  // Never earlier than today: bookings are only kept from midnight onwards. Worked out
  // as plain numbers so the memo below can trust its inputs.
  const firstMs = Math.max(anchor.getTime(), today.getTime());
  const first = new Date(firstMs);
  // Memoised so the grid, which skips re-rendering on equal props, is not redrawn by
  // the sidebar's one-second countdown ticks.
  const days = useMemo(
    () => (view === "week" ? visibleDays(new Date(firstMs), 7) : [new Date(firstMs)]),
    [view, firstMs],
  );
  const last = days[days.length - 1];
  const step = view === "week" ? 7 : 1;
  const shown = useMemo(
    () => machines.filter((m) => !hiddenMachines.has(m.id)),
    [machines, hiddenMachines],
  );
  const openDay = useCallback((day: Date) => {
    setAnchor(startOfDay(day));
    setView("day");
  }, []);

  const title =
    view === "day"
      ? format(first, "EEEE d MMMM yyyy")
      : first.getMonth() === last.getMonth()
        ? format(first, "MMMM yyyy")
        : `${format(first, "MMM")} to ${format(last, "MMM yyyy")}`;

  return (
    <div className="flex h-[calc(100svh-6.5rem)] min-h-[36rem] gap-5">
      <aside className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto pr-1 pb-2">
        <Button
          variant="outline"
          className="h-14 self-start rounded-2xl px-6 text-base shadow-md"
          onClick={onBook}
        >
          <IconPlus className="size-5" />
          Book
        </Button>

        <ScheduleBanner date={new Date(now)} />

        <Calendar
          mode="single"
          className="-mx-2 p-0"
          selected={view === "day" ? first : undefined}
          disabled={{ before: today, after: new Date(latestBookingStart(now)) }}
          onSelect={(date) => {
            if (!date) return;
            setAnchor(startOfDay(date));
            setView("day");
          }}
        />

        <section aria-labelledby="machines-heading" className="space-y-1">
          <h2 id="machines-heading" className="px-1 text-sm font-semibold">
            Machines
          </h2>
          {machines.map((m) => (
            <MachineRow
              key={m.id}
              machine={m}
              color={colors[m.id]}
              bookings={bookings}
              now={now}
              shown={!hiddenMachines.has(m.id)}
              onToggle={() => setHiddenMachines(toggle(hiddenMachines, m.id))}
            />
          ))}
        </section>

        <MyBookings
          className="bg-transparent px-1 py-0 ring-0"
          bookings={bookings.filter((b) => !(b as CalendarBooking).inUse)}
          machines={machines}
          colors={colors}
          now={minuteNow}
          onOpen={onOpenBooking}
        />

        <People
          hidden={hiddenPeople}
          onToggle={(uid) => setHiddenPeople(toggle(hiddenPeople, uid))}
        />
      </aside>

      <section
        aria-label="Calendar"
        className="bg-card ring-foreground/10 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl ring-1"
      >
        <div className="flex items-center gap-3 border-b px-4 py-2.5">
          <Button
            variant="outline"
            className="h-9 rounded-full px-4"
            disabled={sameDay(first, today)}
            onClick={() => setAnchor(today)}
          >
            Today
          </Button>
          <div className="flex">
            <Button
              variant="ghost"
              size="icon"
              aria-label={view === "week" ? "Previous week" : "Previous day"}
              disabled={first <= today}
              onClick={() => setAnchor(addDays(first, -step))}
            >
              <IconChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={view === "week" ? "Next week" : "Next day"}
              // Bookings open two weeks ahead; there is nothing to see past that.
              disabled={addDays(first, step).getTime() > latestBookingStart(now)}
              onClick={() => setAnchor(addDays(first, step))}
            >
              <IconChevronRight />
            </Button>
          </div>
          <h1 className="flex-1 text-xl font-medium">{title}</h1>
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="day">Day</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {loading ? (
          <Skeleton className="m-4 flex-1" />
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground m-auto text-sm">
            Tick a machine on the left to see its bookings.
          </p>
        ) : (
          <TimeGrid
            className="flex-1"
            days={days}
            machines={shown}
            colors={colors}
            bookings={bookings}
            now={minuteNow}
            pxPerHour={48}
            laneLabels={view === "day"}
            onPickDay={view === "week" ? openDay : undefined}
            hiddenPeople={hiddenPeople}
            onPickGap={onPickGap}
            onOpenBooking={onOpenBooking}
          />
        )}

        <Legend machines={shown} colors={colors} />
      </section>
    </div>
  );
}

function toggle(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Tick, name and the machine's button on one line; what it is doing underneath. */
function MachineRow({
  machine,
  color,
  bookings,
  now,
  shown,
  onToggle,
}: {
  machine: Machine;
  color: string;
  bookings: Booking[];
  now: number;
  shown: boolean;
  onToggle: () => void;
}) {
  const { member } = useHouse();
  const state = machineState(machine, now);
  const session = machine.currentSession;
  const id = `show-machine-${machine.id}`;

  let status: string;
  if (state === "free" || !session) {
    const next = bookings
      .filter(
        (b) =>
          b.machineId === machine.id &&
          b.startAt.toMillis() > now &&
          sameDay(b.startAt.toDate(), new Date(now)),
      )
      .sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis())[0];
    status = next
      ? `Available · free until ${formatTime(next.startAt.toDate())}`
      : "Available";
  } else {
    const who = session.uid === member?.uid ? "You" : session.displayName;
    status =
      state === "running"
        ? `In use · ${who} · ${formatDuration(session.expectedEndAt.toMillis() - now)} left`
        : `Finished · ${who}, waiting to be emptied · done ${formatDuration(now - session.expectedEndAt.toMillis())} ago`;
  }

  return (
    <div className="hover:bg-muted/50 rounded-lg px-1 py-1.5">
      <div className="flex min-h-10 items-center gap-2.5">
        <input
          id={id}
          type="checkbox"
          checked={shown}
          onChange={onToggle}
          className="size-[18px] shrink-0 cursor-pointer"
          style={{ accentColor: color }}
          aria-label={`Show ${machine.name} on the calendar`}
        />
        <label
          htmlFor={id}
          className="min-w-0 flex-1 cursor-pointer truncate text-sm font-semibold"
        >
          {machine.name}
        </label>
        <MachineAction machine={machine} bookings={bookings} now={now} />
      </div>
      <p
        className={cn(
          "pl-7 text-xs leading-snug",
          state === "free" && "text-emerald-700 dark:text-emerald-400",
          state === "running" && "text-red-700 dark:text-red-400",
          state === "finished" && "text-amber-700 dark:text-amber-400",
        )}
      >
        {status}
      </p>
    </div>
  );
}

/** Housemates, ticked like calendars. Unticked people's bookings go grey, never vanish. */
function People({
  hidden,
  onToggle,
}: {
  hidden: ReadonlySet<string>;
  onToggle: (uid: string) => void;
}) {
  const { member } = useHouse();
  const members = useMembers();
  // You first, then everyone else alphabetically (the query's order).
  const people = [...members.data].sort(
    (a, b) => Number(b.uid === member?.uid) - Number(a.uid === member?.uid),
  );

  return (
    <section aria-labelledby="people-heading" className="space-y-1">
      <h2 id="people-heading" className="px-1 text-sm font-semibold">
        Housemates
      </h2>
      {members.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        people.map((p) => {
          const id = `show-person-${p.uid}`;
          const you = p.uid === member?.uid;
          return (
            <div
              key={p.uid}
              className="hover:bg-muted/50 flex min-h-11 items-center gap-2.5 rounded-lg px-1"
            >
              <input
                id={id}
                type="checkbox"
                checked={!hidden.has(p.uid)}
                disabled={you}
                onChange={() => onToggle(p.uid)}
                className="accent-primary size-[18px] shrink-0 cursor-pointer disabled:cursor-default"
                aria-label={
                  you
                    ? "Your bookings always show"
                    : `Highlight ${p.displayName}'s bookings`
                }
              />
              <span
                aria-hidden
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  you ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {p.displayName.slice(0, 2).toUpperCase()}
              </span>
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                <span className="block truncate text-sm">
                  {you ? `${p.displayName} (you)` : p.displayName}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {p.group}
                </span>
              </label>
            </div>
          );
        })
      )}
      <p className="text-muted-foreground px-1 pt-1 text-xs leading-snug">
        Untick someone to grey out their bookings. Their time still shows as taken.
      </p>
    </section>
  );
}
