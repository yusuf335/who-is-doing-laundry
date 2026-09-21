"use client";

import {
  IconHomePlus,
  IconHourglass,
  IconLogout,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUser,
  IconUserPlus,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LoadingScreen } from "@/components/loading-screen";
import { useAuth } from "@/components/providers/auth-provider";
import { useHouse } from "@/components/providers/house-provider";
import { SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/errors";
import { isFirebaseConfigured } from "@/lib/firebase";
import { runAction } from "@/lib/run-action";
import { deviceTimeZone } from "@/lib/time";
import { DEFAULT_GROUPS, MACHINE_RULE, type InviteLookup } from "@/lib/types";
import {
  createHouseAction,
  joinHouseAction,
  lookupInviteCodeAction,
} from "@/server/actions";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const { status } = useHouse();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    if (!loading && !user) router.replace("/login");
    else if (status === "ready") router.replace("/");
  }, [loading, user, status, router]);

  if (!isFirebaseConfigured) return <SetupNotice />;
  if (loading || !user || status === "loading" || status === "ready")
    return <LoadingScreen />;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Set up your house</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Create a new house, or join the one your housemates already made.
      </p>

      {/* The way out when this is the wrong Google account, which is the usual reason
          somebody lands here unexpectedly. */}
      <div className="bg-muted/60 mt-4 mb-5 flex items-center gap-2 rounded-lg px-3 py-2">
        <IconUser className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          Signed in as <span className="text-foreground font-medium">{user.email}</span>
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true);
            try {
              await signOut();
              router.replace("/login");
            } finally {
              setSigningOut(false);
            }
          }}
        >
          <IconLogout />
          Sign out
        </Button>
      </div>

      <Tabs defaultValue="join">
        <TabsList className="w-full">
          <TabsTrigger value="join" className="flex-1">
            Join a house
          </TabsTrigger>
          <TabsTrigger value="create" className="flex-1">
            Create a house
          </TabsTrigger>
        </TabsList>

        <TabsContent value="join" className="pt-4">
          <JoinHouseCard />
        </TabsContent>
        <TabsContent value="create" className="pt-4">
          <CreateHouseCard />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function JoinHouseCard() {
  const router = useRouter();
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [invite, setInvite] = useState<InviteLookup | null>(null);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  async function findHouse(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const found = await runAction(() => lookupInviteCodeAction(code));
      setInvite(found);
      setGroup(found.groups[0] ?? "");
    } catch (error) {
      toast.error(errorMessage(error, "Could not find that house."));
    } finally {
      setBusy(false);
    }
  }

  async function join(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !invite) return;
    setBusy(true);
    try {
      const result = await runAction(() =>
        joinHouseAction({ code: invite.code, displayName, group }),
      );

      if (result.pending) {
        setPending(true);
        toast.success("Request sent. Your admin decides next.");
        return;
      }

      toast.success(
        result.rejoined
          ? `Welcome back to ${invite.houseName}.`
          : `Joined ${invite.houseName}.`,
      );
      router.replace("/");
    } catch (error) {
      toast.error(errorMessage(error, "Could not join that house."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Join with an invite code</CardTitle>
        <CardDescription>
          Ask a housemate for the six-character code. If you were already in this house,
          the same code puts you back exactly as you were.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {pending && invite ? (
          <WaitingForApproval houseName={invite.houseName} busy={busy} onCheck={join} />
        ) : !invite ? (
          <form className="space-y-3" onSubmit={findHouse}>
            <div className="space-y-1.5">
              <Label htmlFor="invite-code">Invite code</Label>
              <Input
                id="invite-code"
                required
                autoCapitalize="characters"
                placeholder="ABC123"
                className="font-mono tracking-[0.3em] uppercase"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              Find house
            </Button>
          </form>
        ) : (
          <form className="space-y-3" onSubmit={join}>
            <p className="text-sm">
              Joining <span className="font-medium">{invite.houseName}</span>.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="join-name">Your display name</Label>
              <Input
                id="join-name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="join-group">Your group</Label>
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger id="join-group" className="w-full">
                  <SelectValue placeholder="Pick a group" />
                </SelectTrigger>
                <SelectContent>
                  {invite.groups.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setInvite(null)}>
                Back
              </Button>
              <Button type="submit" className="flex-1" disabled={busy || !group}>
                <IconUserPlus />
                Join house
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A house can ask its admin to vet newcomers. Checking back is the same call as joining,
 * so the button here is honest: it tries to join, and says so if the answer is still no.
 */
function WaitingForApproval({
  houseName,
  busy,
  onCheck,
}: {
  houseName: string;
  busy: boolean;
  onCheck: (event: React.FormEvent) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="bg-muted/60 flex items-start gap-3 rounded-lg px-3 py-3">
        <IconHourglass
          className="text-muted-foreground mt-0.5 size-5 shrink-0"
          aria-hidden
        />
        <div className="space-y-1">
          <p className="text-sm font-medium">Waiting for approval</p>
          <p className="text-muted-foreground text-xs">
            {houseName} asks its admin before letting anyone in. They can see your request
            now. Once they say yes, come back here and you are in.
          </p>
        </div>
      </div>
      <form onSubmit={onCheck}>
        <Button type="submit" variant="outline" className="w-full" disabled={busy}>
          <IconRefresh />
          Check again
        </Button>
      </form>
    </div>
  );
}

function CreateHouseCard() {
  const router = useRouter();
  const { user } = useAuth();
  const [houseName, setHouseName] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [groups, setGroups] = useState<string[]>(DEFAULT_GROUPS);
  const [group, setGroup] = useState(DEFAULT_GROUPS[0]);
  const [busy, setBusy] = useState(false);

  const cleanGroups = groups.map((g) => g.trim()).filter(Boolean);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      await runAction(() =>
        createHouseAction({
          houseName,
          displayName,
          timeZone: deviceTimeZone(),
          groups: cleanGroups,
          group: cleanGroups.includes(group) ? group : cleanGroups[0],
        }),
      );
      toast.success("House created. You're the admin.");
      router.replace("/");
    } catch (error) {
      toast.error(errorMessage(error, "Could not create the house."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create a house</CardTitle>
        <CardDescription>
          You become the admin and get an invite code to share.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="house-name">House name</Label>
            <Input
              id="house-name"
              required
              placeholder="12 Oak Street"
              value={houseName}
              onChange={(e) => setHouseName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-name">Your display name</Label>
            <Input
              id="create-name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Groups</Label>
            {groups.map((name, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={name}
                  placeholder="Upstairs"
                  onChange={(e) =>
                    setGroups(groups.map((g, i) => (i === index ? e.target.value : g)))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove group ${name}`}
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-group">Your group</Label>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger id="create-group" className="w-full">
                <SelectValue placeholder="Pick a group" />
              </SelectTrigger>
              <SelectContent>
                {cleanGroups.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-muted-foreground bg-muted/60 rounded-lg px-3 py-2 text-xs">
            Your house starts with a <span className="font-medium">Washer</span> and a{" "}
            <span className="font-medium">Dryer</span>. {MACHINE_RULE} Rename them or add
            more in Settings.
          </p>

          <Button
            type="submit"
            className="w-full"
            disabled={busy || cleanGroups.length === 0}
          >
            <IconHomePlus />
            Create house
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
