import { IconBrandGithub, IconShieldLock, IconWashMachine } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const SOURCE_URL = "https://github.com/yusuf335/who-is-doing-laundry";
const LICENSE_URL = `${SOURCE_URL}/blob/main/LICENSE`;

/** Public (no sign-in needed) so housemates can read it before they decide to join. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <div className="mb-5 flex items-center gap-2">
        <IconShieldLock className="text-primary size-6" aria-hidden />
        <h1 className="text-xl font-semibold tracking-tight">About &amp; privacy</h1>
      </div>

      <Card size="sm" className="gap-3">
        <CardHeader>
          <CardTitle className="text-base">What this app is for</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Several people share one washer and dryer on the lower floor. Nobody upstairs
            can tell whether a machine is available without walking down, nobody knows
            when a running cycle will finish, and clean laundry gets left sitting in the
            drum.
          </p>
          <p>
            This app answers those questions from your phone: which machines are free to
            use right now, who is using one and when it will be done, and who has booked a
            slot later. When a machine is available, anyone can use it. The app just makes
            that visible so there are no wasted trips and no clashes.
          </p>
        </CardContent>
      </Card>

      <Card size="sm" className="mt-3 gap-3">
        <CardHeader>
          <CardTitle className="text-base">History is kept for 7 days</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            The app keeps a short log of recent cycles, and nothing older. It exists for
            one reason: when someone finds laundry sitting in a machine, they can see
            whose it is and ask them to collect it.
          </p>
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
            <span className="font-medium">Everyone in your house can see this log.</span>{" "}
            It is not private to you and not admin-only: every housemate sees every cycle
            from the last 7 days, including yours, with your name on it. That is the
            point, since it is how lost laundry gets claimed. Nobody outside the house can
            see it.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              The <strong>History</strong> tab, visible to every member of your house,
              lists cycles from the last 7 days: who ran which machine, and when it
              started and finished. Entries older than that are deleted automatically, so
              there is no long-term record of anyone&apos;s habits.
            </li>
            <li>
              Bookings exist only until their time slot has passed, then they are deleted
              automatically.
            </li>
            <li>
              What is stored: your Google display name and email (so housemates know who
              you are), the group you chose, the house you belong to, your{" "}
              <em>upcoming</em> bookings, and your cycles from the last 7 days. Nothing
              else.
            </li>
            <li>
              <span className="font-medium">An email, only if you ask for one.</span>{" "}
              Email takes two switches: your admin has to allow it for the house, and then
              you have to turn it on for yourself under Notifications in the account menu.
              Both start off. When both are on, starting a cycle asks Resend, an email
              service, to send you a reminder when it finishes; Resend is then given your
              email address, your first name, and the machine and time. Nobody else is
              emailed, and the app sends you nothing else: no newsletters, no digests, no
              marketing.
            </li>
            <li>
              <span className="font-medium">A notification, if you ask for one.</span>{" "}
              Switching it on stores an anonymous code for your browser, which
              Google&apos;s notification service uses to reach that device. Your
              housemates can see those codes, because whoever&apos;s app notices your
              machine has finished is what triggers the message, but a code cannot be used
              to send you anything on its own. It says your laundry is done and nothing
              more. Turning the switch off deletes it.
            </li>
            <li>
              Google account data: signing in with Google gives the app only your name,
              email address and account id. They are used to identify you to your
              housemates and nothing else. No other Google data is requested, and nothing
              is shared back to Google beyond the sign-in itself.
            </li>
            <li>
              Only signed-in members of your house can read any of it. There is no public
              access and no analytics or tracking.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card size="sm" className="mt-3 gap-3">
        <CardHeader>
          <CardTitle className="text-base">How privacy is maintained</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-medium">Delete, don&apos;t archive.</span> Past
              bookings are removed as soon as their slot has passed, and cycles once they
              are a week old. The deletion is automatic: every time someone opens the app
              it sweeps whatever has expired, so there is no long-term log to export,
              leak, or be asked for.
            </li>
            <li>
              <span className="font-medium">Members only, but all members.</span> Database
              rules reject every request that is not from a signed-in member of your
              house, including the app&apos;s own server. Within the house there are no
              secrets: any member can see the machines, the bookings and the 7-day log.
              Joining needs an invite code from a housemate.
            </li>
            <li>
              <span className="font-medium">Least data.</span> Sign-in is Google only; the
              app stores the name and email Google provides, your group, and upcoming
              bookings. No phone numbers, no photos, no location.
            </li>
            <li>
              <span className="font-medium">Almost no third parties.</span> No analytics,
              ads or tracking scripts. Data lives in a Firebase project the house admin
              owns. Two things can leave it, both only for you: a notification, if you
              switched it on, through Google&apos;s notification service, and the reminder
              email, if your admin switched that on, through Resend. With both off nothing
              leaves Firebase at all.
            </li>
            <li>
              <span className="font-medium">Your admin can remove you</span> and you can
              leave; either way your membership record goes with you.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card size="sm" className="mt-3 gap-3">
        <CardHeader>
          <CardTitle className="text-base">Don&apos;t take our word for it</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Anyone can copy open-source code and change it, so a promise on a web page is
            only as good as your ability to check it. Here is what you can check:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-medium">
                The rules, not the app, guard the database.
              </span>{" "}
              Firebase enforces the security rules on every request. They allow only the
              collections listed in the source; a modified app cannot add a hidden log
              without the admin also changing the rules in the Firebase console.
            </li>
            <li>
              <span className="font-medium">The server has no master key.</span> It acts
              with each person&apos;s own sign-in token, so it can never read more than
              that person could.
            </li>
            <li>
              <span className="font-medium">Your admin runs this copy.</span> The data is
              in a Firebase project owned by the housemate who set the app up. Ask them to
              show you the project if you want. The code is open source, so other people
              and companies are free to run their own copies; each of those is a separate
              project with its own data, and none of them can see yours.
            </li>
          </ul>
          <p className="text-muted-foreground">
            This page is written by the author as a description of what the unmodified
            code does. The person who runs your copy (your house admin) is the operator
            responsible for your data, and these statements are theirs to stand behind.
            The code is released under the{" "}
            <a
              href={LICENSE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              MIT License
            </a>
            : provided as is, without warranty of any kind, and the author is not liable
            for how it is used or for copies that have been modified.
          </p>
          <Button asChild variant="outline" className="w-full">
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">
              <IconBrandGithub />
              View the source on GitHub
            </a>
          </Button>
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-6 text-center text-xs">
        <Link
          href="/"
          className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
        >
          <IconWashMachine className="size-3.5" aria-hidden />
          Back to the app
        </Link>
      </p>
    </main>
  );
}
