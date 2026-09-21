"use client";

import { IconCalendarEvent, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { useHouse } from "@/components/providers/house-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { runAction } from "@/lib/run-action";
import { formatDayAndTime, formatTime } from "@/lib/time";
import type { Booking, Machine } from "@/lib/types";
import { cn } from "@/lib/utils";
import { cancelBookingAction } from "@/server/actions";

export function BookingList({
  bookings,
  machines,
  emptyLabel = "No bookings yet.",
  showMachine = true,
  compact = false,
  onSelect,
}: {
  bookings: Booking[];
  machines: Machine[];
  emptyLabel?: string;
  showMachine?: boolean;
  /** Single-line rows for the dashboard cards. */
  compact?: boolean;
  /** Makes each row open its day and machine in the picker above. */
  onSelect?: (booking: Booking) => void;
}) {
  const { houseId, member, isAdmin } = useHouse();
  const [cancelling, setCancelling] = useState<string | null>(null);

  if (bookings.length === 0) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
        <IconCalendarEvent className="size-4" />
        {emptyLabel}
      </p>
    );
  }

  async function cancel(booking: Booking) {
    if (!houseId) return;
    setCancelling(booking.id);
    try {
      await runAction(() => cancelBookingAction({ houseId, bookingId: booking.id }));
      toast.success("Booking cancelled.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not cancel that booking."));
    } finally {
      setCancelling(null);
    }
  }

  return (
    <ul className="divide-y">
      {bookings.map((booking) => {
        const start = booking.startAt.toDate();
        const end = booking.endAt.toDate();
        const mine = booking.uid === member?.uid;
        const machine = machines.find((m) => m.id === booking.machineId);
        return (
          <li
            key={booking.id}
            className={cn("flex items-center gap-3", compact ? "py-1.5" : "py-2.5")}
          >
            <Row
              onSelect={onSelect ? () => onSelect(booking) : undefined}
              label={`Show ${formatDayAndTime(start)}`}
            >
              <p className={cn("truncate font-medium", compact ? "text-xs" : "text-sm")}>
                <span className="tabular-nums">
                  {compact ? formatTime(start) : formatDayAndTime(start)} –{" "}
                  {formatTime(end)}
                </span>
                {compact && (
                  <span className="text-muted-foreground font-normal">
                    {" · "}
                    {mine ? "You" : booking.displayName}
                  </span>
                )}
              </p>
              {!compact && (
                <p className="text-muted-foreground truncate text-xs">
                  {mine ? "You" : booking.displayName}
                  {showMachine && machine ? ` · ${machine.name}` : ""}
                </p>
              )}
            </Row>
            {mine && !compact && <Badge variant="outline">Yours</Badge>}
            {(mine || isAdmin) && (
              <Button
                variant="ghost"
                size="icon"
                className={cn(compact && "size-8")}
                aria-label="Cancel booking"
                disabled={cancelling === booking.id}
                onClick={() => cancel(booking)}
              >
                <IconTrash />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A plain cell, or a button when the list is navigable. */
function Row({
  onSelect,
  label,
  children,
}: {
  onSelect?: () => void;
  label: string;
  children: React.ReactNode;
}) {
  if (!onSelect) return <div className="min-w-0 flex-1">{children}</div>;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      className="hover:text-primary min-w-0 flex-1 text-left"
    >
      {children}
    </button>
  );
}
