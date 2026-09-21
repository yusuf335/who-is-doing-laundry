"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconCheck,
  IconCopy,
  IconDeviceFloppy,
  IconDoorExit,
  IconLock,
  IconAlertTriangle,
  IconClockCog,
  IconGripVertical,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUsers,
  IconWashMachine,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { useHouse } from "@/components/providers/house-provider";
import { MyNotifications } from "@/components/my-notifications";
import { RequireHouse } from "@/components/require-house";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useJoinRequests, useMachines, useMembers } from "@/hooks/use-house-data";
import { errorMessage } from "@/lib/errors";
import { scheduleModeOf } from "@/lib/schedule";
import { deviceTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { runAction } from "@/lib/run-action";
import {
  addMachineAction,
  regenerateInviteCodeAction,
  removeMachineAction,
  removeMemberAction,
  reorderMachinesAction,
  decideJoinRequestAction,
  leaveHouseAction,
  renameMachineAction,
  setEmailRemindersAction,
  setJoinApprovalAction,
  updateMachineCyclesAction,
  updateHouseDetailsAction,
  updateMemberGroupAction,
  updateScheduleAction,
  updateScheduleSettingsAction,
} from "@/server/actions";
import {
  MACHINE_TYPES,
  MACHINE_TYPE_LABELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  type House,
  type Machine,
  type MachineType,
  type Member,
  type Cycle,
  type Schedule,
  type ScheduleMode,
  SCHEDULE_MODES,
  SCHEDULE_MODE_LABELS,
  MACHINE_RULE,
  MACHINE_TYPE_HINTS,
  MAX_CYCLES_PER_MACHINE,
  machineTypeWarning,
  cyclesOf,
  maxMinutesOf,
} from "@/lib/types";

/** shadcn Select cannot hold an empty value, so "open to everyone" gets a sentinel. */
const OPEN_DAY = "__open__";

export default function SettingsPage() {
  return (
    <RequireHouse>
      <Settings />
    </RequireHouse>
  );
}

function Settings() {
  const { house, isAdmin } = useHouse();
  const members = useMembers();
  const machines = useMachines();

  if (!house) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your notifications</CardTitle>
          <CardDescription>
            Yours alone. Changing these does nothing to your housemates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MyNotifications />
        </CardContent>
      </Card>

      {/* Everyone sees who is in the house; only the admin can change any of it. */}
      <MembersCard
        house={house}
        members={members.data}
        loading={members.loading}
        canManage={isAdmin}
      />

      {isAdmin && (
        <>
          <InviteCodeCard house={house} />
          <JoinApprovalCard house={house} />
          <HouseDetailsCard
            key={`${house.name}|${house.groups.join("|")}`}
            house={house}
          />
          <ScheduleCard key={JSON.stringify(house.schedule)} house={house} />
          <EmailRemindersCard house={house} />
          <MachinesCard
            house={house}
            machines={machines.data}
            loading={machines.loading}
          />
        </>
      )}

      {!isAdmin && <HouseRulesCard house={house} />}
      <LeaveHouseCard house={house} isAdmin={isAdmin} />
    </div>
  );
}

/**
 * Leaving takes your membership, your upcoming bookings and your notification devices
 * with you. The admin cannot leave, because a house without an admin can never be
 * administered again, so they are told why rather than shown a button that fails.
 */
function LeaveHouseCard({ house, isAdmin }: { house: House; isAdmin: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function leave() {
    setBusy(true);
    try {
      const result = await runAction(() => leaveHouseAction({ houseId: house.id }));
      toast.success(
        result.bookingsCancelled > 0
          ? `You left ${house.name}. ${result.bookingsCancelled} booking${
              result.bookingsCancelled === 1 ? " was" : "s were"
            } cancelled.`
          : `You left ${house.name}.`,
      );
      router.replace("/onboarding");
    } catch (error) {
      toast.error(errorMessage(error, "Could not leave the house."));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Leave this house</CardTitle>
        <CardDescription>
          {isAdmin
            ? "You set this house up, so you cannot leave it. A house with no admin could never be changed again."
            : "You stop seeing the machines and your upcoming bookings are cancelled. The same invite code lets you back in."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive w-full sm:w-auto"
          disabled={isAdmin || busy}
          onClick={() => setConfirming(true)}
        >
          <IconDoorExit />
          Leave {house.name}
        </Button>
      </CardContent>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Leave ${house.name}?`}
        description="Your upcoming bookings are cancelled and this device stops being notified. Your housemates keep the machines, the schedule and the last week of history."
        confirmLabel="Leave"
        cancelLabel="Stay"
        confirmWord="leave"
        icon={<IconDoorExit />}
        busy={busy}
        onConfirm={leave}
      />
    </Card>
  );
}

/**
 * What a member can usefully know about the house without being able to change it: the
 * day schedule and whether email is available at all.
 */
function HouseRulesCard({ house }: { house: House }) {
  const mode = scheduleModeOf(house);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">House rules</CardTitle>
        <CardDescription>
          Set by your admin. {SCHEDULE_MODE_LABELS[mode].description}
        </CardDescription>
      </CardHeader>
      {mode !== "open" && (
        <CardContent>
          <ul className="divide-y text-sm">
            {WEEKDAYS.map((day) => (
              <li key={day} className="flex items-center justify-between gap-3 py-2">
                <span>{WEEKDAY_LABELS[day]}</span>
                <span className="text-muted-foreground">
                  {house.schedule?.[day] ?? "Open to everyone"}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

/** Whether the invite code lets people straight in, plus anyone currently waiting. */
function JoinApprovalCard({ house }: { house: House }) {
  const required = house.requireApproval === true;
  const requests = useJoinRequests();
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await runAction(() => setJoinApprovalAction({ houseId: house.id, required: next }));
      toast.success(
        next
          ? "New housemates now need your approval."
          : "The code lets people straight in.",
      );
    } catch (error) {
      toast.error(errorMessage(error, "Could not change that setting."));
    } finally {
      setBusy(false);
    }
  }

  async function decide(uid: string, name: string, approve: boolean) {
    setDeciding(uid);
    try {
      await runAction(() => decideJoinRequestAction({ houseId: house.id, uid, approve }));
      toast.success(approve ? `${name} can join.` : `${name} was turned down.`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not answer that request."));
    } finally {
      setDeciding(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Joining</CardTitle>
        <CardDescription>
          By default the invite code is the only gate. Turn this on if you would rather
          see who is asking before they are in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id="require-approval"
            checked={required}
            disabled={busy}
            onCheckedChange={toggle}
          />
          <Label htmlFor="require-approval" className="text-sm font-normal">
            {required ? "I approve each new housemate" : "The invite code is enough"}
          </Label>
        </div>

        {required && (
          <div className="border-t pt-4">
            <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
              Waiting for you
            </p>
            {requests.loading ? (
              <Skeleton className="h-10 w-full" />
            ) : requests.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nobody is waiting.</p>
            ) : (
              <ul className="divide-y">
                {requests.data.map((request) => (
                  <li
                    key={request.uid}
                    className="flex flex-wrap items-center gap-2 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {request.displayName}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {request.email} · wants to be in {request.group}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      disabled={deciding === request.uid}
                      onClick={() => decide(request.uid, request.displayName, false)}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      disabled={deciding === request.uid}
                      onClick={() => decide(request.uid, request.displayName, true)}
                    >
                      <IconCheck />
                      Approve
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InviteCodeCard({ house }: { house: House }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(house.inviteCode);
      setCopied(true);
      toast.success("Invite code copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Long-press the code to select it.");
    }
  }

  async function regenerate() {
    setBusy(true);
    try {
      const { code } = await runAction(() =>
        regenerateInviteCodeAction({ houseId: house.id }),
      );
      toast.success(`New invite code: ${code}. The old one no longer works.`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not regenerate the code."));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invite code</CardTitle>
        <CardDescription>
          Share this with housemates. They enter it on the join screen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="bg-muted rounded-lg py-4 text-center font-mono text-3xl font-semibold tracking-[0.35em] select-all">
          {house.inviteCode}
        </p>
        <div className="flex gap-2">
          <Button size="lg" className="flex-1" onClick={copy}>
            {copied ? <IconCheck /> : <IconCopy />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            <IconRefresh />
            Regenerate
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirming} onOpenChange={(next) => !busy && setConfirming(next)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Make a new invite code?</DialogTitle>
            <DialogDescription>
              The current code stops working immediately. Anyone who already joined keeps
              their access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Keep current code
            </Button>
            <Button onClick={regenerate} disabled={busy}>
              <IconRefresh />
              New code
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function HouseDetailsCard({ house }: { house: House }) {
  const [name, setName] = useState(house.name);
  const [groups, setGroups] = useState<string[]>(house.groups);
  const [busy, setBusy] = useState(false);

  const cleanGroups = groups.map((g) => g.trim()).filter(Boolean);
  const dirty = name !== house.name || cleanGroups.join("|") !== house.groups.join("|");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await runAction(() =>
        updateHouseDetailsAction({ houseId: house.id, name, groups: cleanGroups }),
      );
      toast.success("House details saved.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the house details."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">House &amp; groups</CardTitle>
        <CardDescription>
          Groups are the sides of the house that share laundry days, like Upstairs and
          Downstairs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={save}>
          <div className="space-y-1.5">
            <Label htmlFor="house-name">House name</Label>
            <Input
              id="house-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Groups</Label>
            {groups.map((group, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={group}
                  placeholder="Group name"
                  onChange={(e) =>
                    setGroups(groups.map((g, i) => (i === index ? e.target.value : g)))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove group ${group}`}
                  disabled={groups.length <= 1}
                  onClick={() => setGroups(groups.filter((_, i) => i !== index))}
                >
                  <IconTrash />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setGroups([...groups, ""])}
            >
              <IconPlus />
              Add group
            </Button>
            <p className="text-muted-foreground text-xs">
              Removing a group moves its members to the first remaining group and clears
              it from the schedule.
            </p>
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={busy || !dirty || cleanGroups.length === 0}
          >
            <IconDeviceFloppy />
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ScheduleCard({ house }: { house: House }) {
  const [schedule, setSchedule] = useState<Schedule>(house.schedule);
  const [busy, setBusy] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const mode = scheduleModeOf(house);
  const houseZone = house.timeZone ?? "UTC";
  const phoneZone = deviceTimeZone();

  async function saveSettings(next: { scheduleMode?: ScheduleMode; timeZone?: string }) {
    setSavingMode(true);
    try {
      await runAction(() =>
        updateScheduleSettingsAction({
          houseId: house.id,
          scheduleMode: next.scheduleMode ?? mode,
          timeZone: next.timeZone ?? houseZone,
        }),
      );
      toast.success("Schedule settings saved.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the schedule settings."));
    } finally {
      setSavingMode(false);
    }
  }

  const dirty = WEEKDAYS.some(
    (day) => (schedule[day] ?? null) !== (house.schedule[day] ?? null),
  );

  async function save() {
    setBusy(true);
    try {
      await runAction(() => updateScheduleAction({ houseId: house.id, schedule }));
      toast.success("Schedule saved.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the schedule."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Day schedule</CardTitle>
        <CardDescription>
          How much the days matter, and who owns which day.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div role="radiogroup" aria-label="Schedule mode" className="space-y-2">
          {SCHEDULE_MODES.map((option) => {
            const selected = option === mode;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={savingMode || selected}
                onClick={() => saveSettings({ scheduleMode: option })}
                className={cn(
                  "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selected
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/60 disabled:opacity-60",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {option === "strict" && <IconLock className="size-4" aria-hidden />}
                  {SCHEDULE_MODE_LABELS[option].title}
                  {selected && (
                    <Badge variant="default" className="ml-auto h-5">
                      On
                    </Badge>
                  )}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-xs">
                  {SCHEDULE_MODE_LABELS[option].description}
                </span>
              </button>
            );
          })}
        </div>

        {mode !== "open" && (
          <p className="text-muted-foreground text-xs">
            Days change at midnight in <span className="font-medium">{houseZone}</span>.
            {phoneZone !== houseZone && (
              <>
                {" "}
                <button
                  type="button"
                  className="underline underline-offset-4"
                  disabled={savingMode}
                  onClick={() => saveSettings({ timeZone: phoneZone })}
                >
                  Use this phone&apos;s zone ({phoneZone})
                </button>
              </>
            )}
          </p>
        )}

        {mode !== "open" &&
          WEEKDAYS.map((day) => (
            <div key={day} className="flex items-center gap-3">
              <Label htmlFor={`schedule-${day}`} className="w-24 shrink-0">
                {WEEKDAY_LABELS[day]}
              </Label>
              <Select
                value={schedule[day] ?? OPEN_DAY}
                onValueChange={(value) =>
                  setSchedule({ ...schedule, [day]: value === OPEN_DAY ? null : value })
                }
              >
                <SelectTrigger id={`schedule-${day}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OPEN_DAY}>Open to everyone</SelectItem>
                  {house.groups.map((group) => (
                    <SelectItem key={group} value={group}>
                      {group}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        {mode !== "open" && (
          <Button size="lg" className="w-full" disabled={busy || !dirty} onClick={save}>
            <IconDeviceFloppy />
            Save schedule
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Notifications are the channel that people actually want; email is here for houses whose
 * members do not install the app, so it starts off and the admin decides.
 */
function EmailRemindersCard({ house }: { house: House }) {
  const enabled = house.emailReminders === true;
  const [from, setFrom] = useState(house.emailFrom ?? "");
  const [busy, setBusy] = useState(false);

  const senderChanged = from.trim() !== (house.emailFrom ?? "").trim();

  async function save(next: boolean, sender?: string) {
    setBusy(true);
    try {
      await runAction(() =>
        setEmailRemindersAction({
          houseId: house.id,
          enabled: next,
          ...(sender === undefined ? {} : { from: sender }),
        }),
      );
      toast.success(
        sender !== undefined && next === enabled
          ? "Sender saved."
          : next
            ? "Email reminders on."
            : "Email reminders off.",
      );
    } catch (error) {
      toast.error(errorMessage(error, "Could not change that setting."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Email reminders</CardTitle>
        <CardDescription>
          Everyone is notified on their own devices when their laundry is done. This lets
          housemates additionally ask for an email, which is useful for anyone who has not
          added the app to their home screen. Each person still opts in for themselves, so
          turning this on emails nobody by itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id="email-reminders"
            checked={enabled}
            disabled={busy || (!enabled && !from.trim())}
            onCheckedChange={(next) => save(next)}
          />
          <Label htmlFor="email-reminders" className="text-sm font-normal">
            {enabled
              ? "Housemates may switch email on for themselves"
              : "Notifications only, email not offered"}
          </Label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email-from">Send from</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="email-from"
              placeholder="Laundry <laundry@example.com>"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy || !senderChanged || !from.trim()}
              onClick={() => save(enabled, from)}
            >
              <IconDeviceFloppy />
              Save
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            The domain has to be verified in the Resend account this app is connected to,
            otherwise the email is refused. This is not a secret, unlike the API key,
            which stays on the server.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function MachinesCard({
  house,
  machines,
  loading,
}: {
  house: House;
  machines: Machine[];
  loading: boolean;
}) {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<MachineType>("washer");
  const [busy, setBusy] = useState(false);

  const typeWarning = machineTypeWarning(newType, machines);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await runAction(() =>
        addMachineAction({ houseId: house.id, name: newName, type: newType }),
      );
      toast.success(`${newName.trim()} added.`);
      setNewName("");
    } catch (error) {
      toast.error(errorMessage(error, "Could not add the machine."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Machines</CardTitle>
        <CardDescription>
          {MACHINE_RULE} Drag the handle to change the order they appear in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : machines.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <IconWashMachine className="size-4" />
            No machines yet. Add one below.
          </p>
        ) : (
          <SortableMachines houseId={house.id} machines={machines} />
        )}

        <form className="space-y-2 border-t pt-4" onSubmit={add}>
          <Label htmlFor="new-machine">Add a machine</Label>
          <p className="text-muted-foreground text-xs">{MACHINE_RULE}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="new-machine"
              required
              placeholder="e.g. Washer 2"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Select value={newType} onValueChange={(v) => setNewType(v as MachineType)}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Machine type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MACHINE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {MACHINE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="lg" disabled={busy || !newName.trim()}>
              <IconPlus />
              Add
            </Button>
          </div>

          <p className="text-muted-foreground text-xs">{MACHINE_TYPE_HINTS[newType]}</p>

          {typeWarning && (
            <Alert>
              <IconAlertTriangle />
              <AlertTitle>Is this a second appliance?</AlertTitle>
              <AlertDescription>{typeWarning}</AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Drag-and-drop ordering. The list reorders optimistically and is saved as soon as the
 * drop lands; if the save fails the live snapshot puts the old order back.
 */
function SortableMachines({
  houseId,
  machines,
}: {
  houseId: string;
  machines: Machine[];
}) {
  // Optimistic order, tagged with the snapshot it was derived from: once a new snapshot
  // arrives (our save landed, or someone else changed the list) it wins again.
  const [optimistic, setOptimistic] = useState<{
    source: Machine[];
    items: Machine[];
  } | null>(null);
  const items = optimistic?.source === machines ? optimistic.items : machines;

  const sensors = useSensors(
    // A small activation distance keeps taps on the inputs from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((m) => m.id === active.id);
    const to = items.findIndex((m) => m.id === over.id);
    const next = arrayMove(items, from, to);
    setOptimistic({ source: machines, items: next });
    try {
      await runAction(() =>
        reorderMachinesAction({ houseId, machineIds: next.map((m) => m.id) }),
      );
    } catch (error) {
      setOptimistic(null);
      toast.error(errorMessage(error, "Could not save the new order."));
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={items.map((m) => m.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="divide-y">
          {items.map((machine) => (
            <MachineRow
              key={`${machine.id}|${machine.name}`}
              houseId={houseId}
              machine={machine}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function MachineRow({ houseId, machine }: { houseId: string; machine: Machine }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: machine.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const [name, setName] = useState(machine.name);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await runAction(() =>
        renameMachineAction({ houseId, machineId: machine.id, name }),
      );
      toast.success("Machine renamed.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not rename the machine."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await runAction(() => removeMachineAction({ houseId, machineId: machine.id }));
      toast.success(`${machine.name} removed.`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not remove the machine."));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn("bg-card py-3", isDragging && "relative z-10 opacity-80 shadow-lg")}
    >
      <form className="flex items-center gap-2" onSubmit={rename}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="text-muted-foreground hover:text-foreground flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md active:cursor-grabbing"
          aria-label={`Drag to reorder ${machine.name}`}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical className="size-5" />
        </button>
        <Input
          aria-label={`Name of ${machine.name}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
          {MACHINE_TYPE_LABELS[machine.type]}
        </Badge>
        <Button
          type="submit"
          variant="outline"
          size="icon"
          aria-label="Save name"
          disabled={busy || !name.trim() || name.trim() === machine.name}
        >
          <IconDeviceFloppy />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${machine.name}`}
          disabled={busy || machine.status === "in_use"}
          title={machine.status === "in_use" ? "Stop the running cycle first" : "Remove"}
          onClick={() => setConfirming(true)}
        >
          <IconTrash />
        </Button>
      </form>

      <CyclesEditor houseId={houseId} machine={machine} />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove ${machine.name}?`}
        description="Its card disappears from the home screen. Any of its bookings are cancelled."
        confirmLabel="Remove"
        busy={busy}
        onConfirm={remove}
      />
    </li>
  );
}

/**
 * Named cycle presets ("Normal", "Heavy", ...) and the longest custom cycle, per machine.
 * Collapsed by default so the machine list stays scannable.
 */
function CyclesEditor({ houseId, machine }: { houseId: string; machine: Machine }) {
  const [open, setOpen] = useState(false);
  const [cycles, setCycles] = useState<Cycle[]>(() => cyclesOf(machine));
  const [maxMinutes, setMaxMinutes] = useState<string>(() =>
    String(maxMinutesOf(machine)),
  );
  const [busy, setBusy] = useState(false);

  const max = Number(maxMinutes);
  const problems = cycles.some(
    (c) =>
      !c.name.trim() || !Number.isInteger(c.minutes) || c.minutes < 1 || c.minutes > max,
  );
  const dirty =
    JSON.stringify(cycles) !== JSON.stringify(cyclesOf(machine)) ||
    max !== maxMinutesOf(machine);

  async function save() {
    setBusy(true);
    try {
      await runAction(() =>
        updateMachineCyclesAction({
          houseId,
          machineId: machine.id,
          cycles,
          maxMinutes: max,
        }),
      );
      toast.success(`${machine.name} cycles saved.`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the cycles."));
    } finally {
      setBusy(false);
    }
  }

  const summary = cyclesOf(machine)
    .map((c) => `${c.name} ${c.minutes}m`)
    .join(" · ");

  return (
    <div className="mt-2 pl-10">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex h-8 w-full items-center gap-1.5 text-xs"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <IconClockCog className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          {summary} · max {maxMinutesOf(machine)}m
        </span>
      </button>

      {open && (
        <div className="space-y-2 pt-1 pb-2">
          {cycles.map((cycle, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label={`Cycle ${index + 1} name`}
                placeholder="Normal"
                maxLength={24}
                value={cycle.name}
                onChange={(e) =>
                  setCycles(
                    cycles.map((c, i) =>
                      i === index ? { ...c, name: e.target.value } : c,
                    ),
                  )
                }
              />
              <Input
                aria-label={`Cycle ${index + 1} minutes`}
                type="number"
                inputMode="numeric"
                min={1}
                max={max}
                className="w-24 shrink-0"
                value={cycle.minutes || ""}
                onChange={(e) =>
                  setCycles(
                    cycles.map((c, i) =>
                      i === index ? { ...c, minutes: Number(e.target.value) } : c,
                    ),
                  )
                }
              />
              <span className="text-muted-foreground w-8 shrink-0 text-xs">min</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove cycle ${cycle.name || index + 1}`}
                disabled={cycles.length <= 1}
                onClick={() => setCycles(cycles.filter((_, i) => i !== index))}
              >
                <IconTrash />
              </Button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={cycles.length >= MAX_CYCLES_PER_MACHINE}
              onClick={() => setCycles([...cycles, { name: "", minutes: 60 }])}
            >
              <IconPlus />
              Add cycle
            </Button>
            <Label htmlFor={`max-${machine.id}`} className="ml-auto text-xs">
              Custom up to
            </Label>
            <Input
              id={`max-${machine.id}`}
              type="number"
              inputMode="numeric"
              min={15}
              max={600}
              className="w-24"
              value={maxMinutes}
              onChange={(e) => setMaxMinutes(e.target.value)}
            />
            <span className="text-muted-foreground text-xs">min</span>
          </div>

          <Button
            size="sm"
            className="w-full"
            disabled={busy || !dirty || problems || !Number.isInteger(max)}
            onClick={save}
          >
            <IconDeviceFloppy />
            Save cycles
          </Button>
        </div>
      )}
    </div>
  );
}

/** One confirmation for every destructive action, so they all look and behave the same. */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
  confirmWord,
  icon,
  cancelLabel = "Keep",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  /** Ask the person to type this before the action unlocks. */
  confirmWord?: string;
  icon?: React.ReactNode;
  /** The way out. "Stay" reads right next to Leave; "Keep" next to Remove. */
  cancelLabel?: string;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The button stays live even before the word is typed: a dead button explains nothing,
  // and pressing it is how somebody finds out what is missing.
  function attempt() {
    if (confirmWord && typed.trim().toLowerCase() !== confirmWord.toLowerCase()) {
      setError(`Type ${confirmWord} to confirm.`);
      document.getElementById("confirm-word")?.focus();
      return;
    }
    onConfirm();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) {
          setTyped("");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {confirmWord && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-word" className="text-xs">
              Type <span className="font-mono font-medium">{confirmWord}</span> to confirm
            </Label>
            <Input
              id="confirm-word"
              autoComplete="off"
              aria-invalid={error !== null}
              aria-describedby={error ? "confirm-word-error" : undefined}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (error) setError(null);
              }}
            />
            {error && (
              <p
                id="confirm-word-error"
                role="alert"
                className="text-destructive text-xs"
              >
                {error}
              </p>
            )}
          </div>
        )}

        {/* The action sits on the left and the way out on the right, so the safe choice
            is under the thumb and the irreversible one takes a deliberate reach. */}
        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button variant="destructive" onClick={attempt} disabled={busy}>
            {icon ?? <IconTrash />}
            {confirmLabel}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembersCard({
  house,
  members,
  loading,
  canManage,
}: {
  house: House;
  members: Member[];
  loading: boolean;
  canManage: boolean;
}) {
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  async function changeGroup(member: Member, group: string) {
    try {
      await runAction(() =>
        updateMemberGroupAction({ houseId: house.id, uid: member.uid, group }),
      );
      toast.success(`${member.displayName} moved to ${group}.`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not change the group."));
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      await runAction(() => removeMemberAction({ houseId: house.id, uid: removing.uid }));
      toast.success(`${removing.displayName} removed from the house.`);
      setRemoving(null);
    } catch (error) {
      toast.error(errorMessage(error, "Could not remove that member."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Housemates</CardTitle>
        <CardDescription>
          {canManage
            ? "Everyone who has joined with the invite code."
            : "Everyone in this house, and which group they are in."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : members.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <IconUsers className="size-4" />
            Nobody has joined yet.
          </p>
        ) : (
          <ul className="divide-y">
            {members.map((member) => (
              <li key={member.uid} className="flex items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{member.displayName}</span>
                    {member.role === "admin" && (
                      <Badge variant="secondary" className="shrink-0">
                        Admin
                      </Badge>
                    )}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">{member.email}</p>
                </div>
                {!canManage && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {member.group}
                  </span>
                )}
                {canManage && (
                  <Select
                    value={house.groups.includes(member.group) ? member.group : undefined}
                    onValueChange={(group) => changeGroup(member, group)}
                  >
                    <SelectTrigger
                      className="w-32"
                      aria-label={`Group of ${member.displayName}`}
                    >
                      <SelectValue placeholder="Group" />
                    </SelectTrigger>
                    <SelectContent>
                      {house.groups.map((group) => (
                        <SelectItem key={group} value={group}>
                          {group}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${member.displayName}`}
                    title={
                      member.role === "admin" ? "The admin can't be removed" : "Remove"
                    }
                    disabled={member.role === "admin"}
                    onClick={() => setRemoving(member)}
                  >
                    <IconTrash />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {removing?.displayName}?</DialogTitle>
            <DialogDescription>
              They will lose access to the house right away. They can join again with the
              invite code.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
              Keep
            </Button>
            <Button variant="destructive" onClick={confirmRemove} disabled={busy}>
              <IconTrash />
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
