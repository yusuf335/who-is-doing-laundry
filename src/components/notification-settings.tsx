"use client";

import { MyNotifications } from "@/components/my-notifications";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** The account-menu version of the same controls that live in settings. */
export function NotificationSettings({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Telling you your laundry is done</DialogTitle>
          <DialogDescription>
            These are your own settings. They change nothing for your housemates.
          </DialogDescription>
        </DialogHeader>

        <MyNotifications />
      </DialogContent>
    </Dialog>
  );
}
