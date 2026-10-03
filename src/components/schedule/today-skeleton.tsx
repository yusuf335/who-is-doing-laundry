import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholders shaped like the Today screen, so the layout is already in place when the
 * machines and bookings arrive and nothing jumps. Phone and desktop each mirror their
 * own layout; CSS picks one, since this shows before anything knows the screen size.
 */
export function TodaySkeleton() {
  return (
    <div role="status" aria-label="Loading the machines and bookings" aria-busy>
      <div className="lg:hidden">
        <PhoneTodaySkeleton />
      </div>
      <div className="hidden lg:block">
        <DesktopTodaySkeleton />
      </div>
    </div>
  );
}

/** Hour lines like the real grid's, so the placeholder reads as a calendar. */
function hourLines(pxPerHour: number): React.CSSProperties {
  return {
    backgroundImage: "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
    backgroundSize: `100% ${pxPerHour}px`,
  };
}

/** A few bookings at fixed spots per lane, so the grid is not an empty box. */
const PLACEHOLDER_BLOCKS: { lane: number; top: number; height: number }[][] = [
  [
    { lane: 0, top: 30, height: 60 },
    { lane: 1, top: 140, height: 44 },
  ],
  [
    { lane: 1, top: 60, height: 70 },
    { lane: 0, top: 190, height: 44 },
  ],
  [
    { lane: 0, top: 100, height: 52 },
    { lane: 1, top: 20, height: 44 },
  ],
];

function DayColumn({ index, lanes }: { index: number; lanes: number }) {
  const blocks = PLACEHOLDER_BLOCKS[index % PLACEHOLDER_BLOCKS.length].filter(
    (block) => block.lane < lanes,
  );
  return (
    <div className="relative border-l">
      <div
        className="absolute inset-0 grid gap-0.5 px-0.5"
        style={{ gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: lanes }, (_, lane) => (
          <div key={lane} className="relative">
            {blocks
              .filter((block) => block.lane === lane)
              .map((block) => (
                <Skeleton
                  key={block.top}
                  className="absolute inset-x-0 rounded-md"
                  style={{ top: block.top, height: block.height }}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function GridSkeleton({
  days,
  lanes,
  pxPerHour,
  className,
}: {
  days: number;
  lanes: number;
  pxPerHour: number;
  className?: string;
}) {
  const columns = { gridTemplateColumns: `2.25rem repeat(${days}, minmax(0, 1fr))` };
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="grid border-b" style={columns}>
        <div />
        {Array.from({ length: days }, (_, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-1 border-l px-1 pt-2 pb-1.5"
          >
            <Skeleton className="h-2.5 w-7" />
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-2 w-12" />
            <div className="mt-0.5 flex w-full gap-0.5">
              {Array.from({ length: lanes }, (_, lane) => (
                <Skeleton key={lane} className="h-1 flex-1 rounded-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{ ...columns, ...hourLines(pxPerHour) }}
      >
        <div className="flex flex-col items-end gap-[1.85rem] pt-2 pr-1.5">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-2 w-5" />
          ))}
        </div>
        {Array.from({ length: days }, (_, i) => (
          <DayColumn key={i} index={i} lanes={lanes} />
        ))}
      </div>
    </div>
  );
}

function MachineCardSkeleton() {
  return (
    <div className="bg-card ring-foreground/10 border-l-muted flex items-center gap-2 rounded-xl border-l-4 p-3 ring-1">
      <Skeleton className="size-7 rounded-md" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="h-9 w-20 rounded-lg" />
    </div>
  );
}

export function PhoneTodaySkeleton({ banner = true }: { banner?: boolean }) {
  return (
    <div className="space-y-3">
      {banner && <Skeleton className="h-9 w-full rounded-lg" />}
      <MachineCardSkeleton />
      <MachineCardSkeleton />

      <section className="bg-card ring-foreground/10 overflow-hidden rounded-xl ring-1">
        <div className="flex items-center gap-2 px-2 py-2">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="mx-auto h-4 w-36" />
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="h-10 w-20 rounded-lg" />
        </div>
        <GridSkeleton
          days={3}
          lanes={2}
          pxPerHour={44}
          className="h-[min(62svh,34rem)] min-h-72 border-t"
        />
        <div className="flex gap-4 border-t px-3 py-2.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-2.5 w-14" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      </section>

      <section className="bg-card ring-foreground/10 space-y-3 rounded-xl px-3 py-3 ring-1">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-full" />
      </section>
    </div>
  );
}

export function DesktopTodaySkeleton() {
  return (
    <div className="flex h-[calc(100svh-6.5rem)] min-h-[36rem] gap-5">
      <aside className="flex w-72 shrink-0 flex-col gap-5">
        <Skeleton className="h-14 w-full rounded-2xl" />
        <Skeleton className="h-9 w-full rounded-lg" />
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="size-6 rounded-md" />
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 35 }, (_, i) => (
              <Skeleton key={i} className="aspect-square rounded-md" />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-20" />
          {[0, 1].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-4 rounded-[4px]" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-9 w-20 rounded-lg" />
              </div>
              <Skeleton className="h-3 w-44" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skeleton className="size-4 rounded-[4px]" />
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </aside>

      <section className="bg-card ring-foreground/10 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl ring-1">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Skeleton className="h-9 w-20 rounded-full" />
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="ml-auto h-9 w-32 rounded-lg" />
        </div>
        <GridSkeleton days={7} lanes={2} pxPerHour={48} className="flex-1" />
      </section>
    </div>
  );
}
