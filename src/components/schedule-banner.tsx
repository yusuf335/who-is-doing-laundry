"use client";

import { IconCalendarClock, IconLock } from "@tabler/icons-react";
import { useHouse } from "@/components/providers/house-provider";
import { Badge } from "@/components/ui/badge";
import { scheduleNoticeFor } from "@/lib/schedule";

/** One line: whose day it is and what that means. Hidden when days are switched off. */
export function ScheduleBanner({ date = new Date() }: { date?: Date }) {
  const { house, member } = useHouse();
  const notice = scheduleNoticeFor(house, member, date);
  if (!notice) return null;

  const strict = notice.mode === "strict";
  const blocked = strict && !notice.isOwnDay;
  const Icon = strict ? IconLock : IconCalendarClock;

  return (
    <div
      role="status"
      className={
        blocked
          ? "flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-800 dark:text-red-300"
          : "bg-muted/60 text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 truncate">
        <span className={blocked ? "font-medium" : "text-foreground font-medium"}>
          {notice.owner ? `${notice.owner} day` : "Open day"}
        </span>
        {" · "}
        {!notice.owner
          ? "anyone can use it"
          : strict
            ? `strict: only ${notice.owner} can start or book today`
            : "machine available? anyone can use it"}
      </p>
      {notice.owner && (
        <Badge
          variant={notice.isOwnDay ? "default" : blocked ? "destructive" : "secondary"}
          className="h-5 shrink-0"
        >
          {notice.isOwnDay ? "Yours" : "Not yours"}
        </Badge>
      )}
    </div>
  );
}
