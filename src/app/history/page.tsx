"use client";

import { IconHistory, IconUsers, IconWashMachine, IconWind } from "@tabler/icons-react";
import { LoadError } from "@/components/load-error";
import { RequireHouse } from "@/components/require-house";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMachines, useRecentSessions } from "@/hooks/use-house-data";
import { useHouse } from "@/components/providers/house-provider";
import { useNow } from "@/hooks/use-now";
import { formatDayAndTime, formatTime, sameDay } from "@/lib/time";
import { SESSION_RETENTION_DAYS, type LaundrySession } from "@/lib/types";

export default function HistoryPage() {
  return (
    <RequireHouse>
      <History />
    </RequireHouse>
  );
}

function History() {
  const { member } = useHouse();
  const sessions = useRecentSessions(50);
  const machines = useMachines();
  const now = useNow(30_000);

  const nameOf = (machineId: string) =>
    machines.data.find((m) => m.id === machineId)?.name ?? "Machine";
  const typeOf = (machineId: string) =>
    machines.data.find((m) => m.id === machineId)?.type ?? "washer";

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Recent laundry</h1>
        <p className="text-muted-foreground text-sm">
          The last {SESSION_RETENTION_DAYS} days, so laundry left in a machine can find
          its owner. Older entries are deleted automatically.
        </p>
        <p className="text-muted-foreground mt-1 flex items-start gap-1.5 text-xs">
          <IconUsers className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Everyone in the house sees this list, including your own cycles.
        </p>
      </div>

      <Card size="sm" className="gap-2">
        <CardHeader>
          <CardTitle className="text-sm">
            {sessions.loading ? "Loading" : `${sessions.data.length} cycles`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : sessions.error ? (
            <LoadError what="the last week" />
          ) : sessions.data.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
              <IconHistory className="size-4" />
              Nothing yet. Start a machine and it shows up here.
            </p>
          ) : (
            <ul className="divide-y">
              {sessions.data.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  machineName={nameOf(session.machineId)}
                  isDryer={typeOf(session.machineId) === "dryer"}
                  mine={session.uid === member?.uid}
                  now={now}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SessionRow({
  session,
  machineName,
  isDryer,
  mine,
  now,
}: {
  session: LaundrySession;
  machineName: string;
  isDryer: boolean;
  mine: boolean;
  now: number;
}) {
  const started = session.startedAt.toDate();
  const ended = session.endedAt?.toDate() ?? null;
  const running = ended === null;
  const Icon = isDryer ? IconWind : IconWashMachine;

  return (
    <li className="flex items-center gap-3 py-2.5">
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {mine ? "You" : session.displayName}
          <span className="text-muted-foreground font-normal"> · {machineName}</span>
        </p>
        <p className="text-muted-foreground truncate text-xs tabular-nums">
          {formatDayAndTime(started, new Date(now))}
          {ended
            ? ` to ${sameDay(started, ended) ? formatTime(ended) : formatDayAndTime(ended, new Date(now))}`
            : ""}
        </p>
      </div>
      {running && (
        <Badge variant="secondary" className="h-5 shrink-0">
          Running
        </Badge>
      )}
    </li>
  );
}
