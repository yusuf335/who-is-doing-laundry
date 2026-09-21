# Who is doing laundry?

A mobile-first web app for a shared house with one laundry area. Every housemate opens
the same link, signs in, and sees at a glance:

1. **Right now**: whether each machine is available or in use, by whom, and a live
   countdown.
2. **Upcoming**: who has booked the machine and when.
3. **The rules**: whose day it is and how strictly that applies, with the reminder (in
   the default mode) that an available machine can be used by anyone.
4. **The last week**: who ran which machine, so laundry left in a drum can find its owner.

It notifies you when your own laundry is done, and booking a washer offers the dryer for
straight afterwards.

Built with Next.js (App Router, TypeScript), shadcn/ui + Tailwind, Firebase Auth
(Google sign-in only), Cloud Firestore real-time listeners and Resend for the one email
it sends. Hosted on Vercel's free tier; Firebase stays on the free Spark plan.

## Firebase setup (once)

1. Create a project at <https://console.firebase.google.com>.
2. **Authentication → Get started → Sign-in method**: enable **Google** (the only provider the app offers).
3. **Firestore Database → Create database** in **production mode** (the rules in this repo
   lock it down; nothing is public).
4. **Project settings → Your apps → Add app → Web**. Copy the config values.
5. Copy `.env.example` to `.env.local` and paste the values in:

   ```
   NEXT_PUBLIC_FIREBASE_API_KEY=…
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=…
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=…
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=…
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=…
   NEXT_PUBLIC_FIREBASE_APP_ID=…
   ```

6. Deploy the security rules. Either paste `firestore.rules` into **Firestore → Rules**
   in the console, or with the CLI:

   ```bash
   npm i -g firebase-tools
   firebase login
   cp .firebaserc.example .firebaserc   # then put your project id in it
   firebase deploy --only firestore:rules
   ```

No composite indexes are needed; every query uses a single field.

## Local development

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Until `.env.local` is filled in, every page shows a
"Firebase isn't configured" notice instead of crashing.

### Optional: run against the emulators

```bash
npm run emulators                 # Auth on 9099, Firestore on 8080, UI on 4000
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true npm run dev
```

With the flag set, both the browser SDK (live listeners) and the server-side
`FirebaseServerApp` (server actions, first-paint session) talk to the emulators, so the
whole stack runs locally. Sign-ups made against the emulator are throwaway.

The emulator needs **Java 21 or newer** (`firebase-tools` 15 refuses older JDKs and only
looks at the `java` on your `PATH`). On macOS `scripts/with-java.sh` (used by
`npm run emulators` and `npm run test:rules`) picks the newest installed JDK ≥ 21 for you.

Note: with no Firebase config at all, every page redirects to `/login`, which shows the
setup notice. That is the proxy doing its job, not a bug.

### Quality checks

```bash
npx tsc --noEmit     # types
npm run lint         # eslint
npm run build        # production build
npm test             # unit tests (pure helpers, no Firebase needed)
npm run test:rules   # security-rules + server-logic tests on the Firestore emulator
```

See `tests/README.md` for what each suite covers.

## Privacy: a 7-day window

Why it matters: an app that logged every cycle forever would be a record of when each
housemate is home, awake and doing chores. Nobody needs that. But a short window is
genuinely useful, so the app keeps exactly one week:

- A running cycle lives on the machine document as `currentSession` and, in parallel, as a
  `sessions` entry. Ending the cycle clears `currentSession` and stamps `endedAt` on the
  log entry.
- The **History** page lists the last 7 days: who ran which machine and when. That is what
  lets someone who finds washing in the drum work out whose it is. It is visible to
  **every member of the house**, not just the admin, and to nobody outside it; the app
  says so on `/privacy` and on the page itself.
- Entries older than 7 days are deleted, as are bookings whose slot has passed. Every
  dashboard load calls `pruneOldRecordsAction`, which removes up to 15 expired bookings
  (plus their slot locks) and 15 stale log entries per call. The rules independently let
  any member delete a booking whose `endAt` has passed or a session older than a week, so
  the sweep does not depend on the admin being around.
- What remains is the minimum to run the house: member names/emails/groups, the machines,
  upcoming bookings, and the last week of cycles.

The `/privacy` page says the same thing to housemates and links to this repository so they
can check for themselves.

### Trust model: what a modified copy can and cannot do

Open source means anyone can fork this and change it, so the privacy page only claims what
can be checked:

- **Rules are enforced by Firebase, not by app code.** `firestore.rules` allows only the
  listed collections, so a modified app cannot add a hidden log to this database unless the
  admin also changes the rules in the console.
- **No admin SDK anywhere.** Server actions use `FirebaseServerApp` with the caller's own
  ID token; the server can never read more than that user could.
- **Each house runs its own copy** in a Firebase project and Vercel account owned by a
  housemate. The person to trust is that housemate. Anyone else, individuals and companies
  alike, may run their own copy under the licence; every copy is a separate project with
  separate data, and no copy can read another's.

This follows the convention of other self-hosted open-source apps (Mastodon, Nextcloud and
the like): the developer's privacy text describes the unmodified software, and whoever
operates an instance is the data controller for its users. The `/privacy` page says so,
and the MIT License (see `LICENSE`) disclaims warranty and liability for all copies,
modified or not.

Google's OAuth policy asks that an app using Google sign-in link to a privacy policy that
says which Google user data it accesses and how it is used. `/privacy` states that (name,
email and account id, used only to identify you to housemates). When you set up the OAuth
consent screen in Google Cloud Console, use `https://<your-domain>/privacy` as the privacy
policy URL and your home page as the app URL.

What it cannot prevent: an operator logging on their own server or exporting the Firebase
project. No app can prevent that; the page says so rather than over-promising.

## Read cost and caching

Firestore bills per document read, and the free tier allows 50,000 a day. The app is built
so a household never approaches that.

- **Live listeners, never polling.** `onSnapshot` charges one read per document the first
  time and one read per document that actually changes. Polling would re-read every
  document on every tick and cost far more for a worse result, so there is no interval to
  tune anywhere in this codebase. If you ever do need a one-off value, use `getDoc`, not a
  timer.
- **No disk cache, on purpose.** `persistentLocalCache` looks like free savings and was
  tried here, but Firestore's IndexedDB cache is keyed by project, not by signed-in user.
  On a browser where two Google accounts have both been used, the second inherits the
  first one's cached documents, including negative entries for documents it was never
  allowed to read. The symptom is nasty: a house document that plainly exists comes back
  from the _server_ listener as not existing, and the app sits on its loading screen with
  no error anywhere. Re-introducing it means clearing IndexedDB whenever the signed-in uid
  changes (`terminate`, then `clearIndexedDbPersistence`, then reload). Until that exists,
  correctness wins.
- **Bounded queries.** Every listener carries a `limit`, and the rules refuse any `list`
  without one (see below), so a runaway query cannot drain the quota.
- **Housekeeping is throttled.** `pruneOldRecordsAction` costs up to 30 reads, so the
  dashboard calls it when it can see an expired booking, and otherwise at most once every
  six hours per browser (tracked in `localStorage`).
- **Server reads are small and deliberate.** The first paint resolves the session with
  three reads, and each server action re-checks membership with two. Actions happen a
  handful of times a day per person.

The dashboard shows when it last heard from the database, and says that it updates on its
own, so nobody goes looking for a refresh button. If the connection drops it says it is
showing saved data instead.

## Abuse protection

The Firebase web config is public by design, so protection comes from layers, not secrecy:

1. **Security rules** deny everything to signed-out users and scope every read and write to
   members of the house. Unauthenticated requests never reach a document read, so they
   cannot burn quota.
2. **Bounded queries.** Every `list` on a house collection must carry `limit <= 200`
   (`boundedList()` in `firestore.rules`), and houses can never be listed. A member who
   scripts the SDK cannot pull whole collections in a loop.
3. **Field validation in rules** mirrors the server's checks (15-minute grid, ≤ 6 h
   bookings, ≤ 10 h cycles, valid groups), so a hand-crafted write cannot corrupt data.
4. **App Check (optional, recommended in production).** Register the web app in
   Console → App Check with a reCAPTCHA v3 site key, set
   `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`, then **enforce** for Cloud Firestore. From
   then on Firestore only accepts requests carrying a token minted for this app; the
   browser mirrors it into the `__app_check` cookie so server actions pass too. For local
   development create a debug token in the console and set
   `NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN`.
5. **Restrict the API key** in Google Cloud Console → APIs & Services → Credentials →
   _Browser key (auto created by Firebase)_ → Application restrictions → HTTP referrers:
   add `localhost:*` and your Vercel domain(s). Copies of the key then fail from anywhere
   else.
6. **Google sign-in only.** No password endpoints to brute-force, and Firebase's own
   per-IP rate limits apply to the sign-in flow.

What abuse _can_ do on the Spark plan: exhaust the daily free quota (50k reads / 20k
writes) and make the app unavailable until midnight Pacific. It can never produce a bill,
because Spark has no billing account to charge, which is the point of staying on it.

## Deploying to Vercel

1. Push the repo to GitHub and import it in Vercel (framework preset: Next.js).
2. Add the six `NEXT_PUBLIC_FIREBASE_*` variables under **Settings → Environment
   Variables**.
3. In Firebase, **Authentication → Settings → Authorized domains**, add your Vercel domain
   (e.g. `your-app.vercel.app`), otherwise Google sign-in is rejected.
4. Share the link. Housemates sign in, and the first one creates the house; everyone else
   joins with the invite code shown in **Settings**.

Good to know on Vercel:

- Do **not** set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS` there; it would point the deployed
  app (browser and server actions alike) at `127.0.0.1`.
- Google sign-in only works on domains listed in Firebase's Authorized domains. Preview
  deployments get their own `*-git-branch-….vercel.app` hostnames, so add the ones you
  want to sign in on (or just test on the production URL).
- The `__session` cookie is `Secure` on https, which Vercel always is; the proxy, server
  actions and the first-paint session run in Vercel's Node.js functions with no extra
  configuration.

## How it works

### Architecture

**Server-side auth.** After sign-in the browser mirrors the Firebase ID token into a
`__session` cookie (kept fresh via `onIdTokenChanged`, and again right before every
server action). `src/proxy.ts` only checks that the cookie _exists_ and redirects
accordingly (signed-out requests to any page go to `/login`, signed-in requests to
`/login` go to `/`), so there is no loading-screen-then-redirect flash. That check is
optimistic, not a verification. The root layout then builds a `FirebaseServerApp` from
the token (`src/lib/firebase-server.ts`) and, if it is valid, renders the signed-in state
and house membership on the first paint. A missing, expired or garbled token simply
yields "unknown" and the client SDK takes over as it would without server auth.

**Business logic in Server Actions.** Every write (creating or joining a house,
starting/ending a cycle, booking, cancelling, and all admin settings) is a Server
Action in `src/server/actions.ts` that delegates to `src/server/laundry.ts`. Each action
runs against a `FirebaseServerApp` signed in _as the caller_, so the Firestore security
rules still apply per user; the server has no privileged credentials. The browser only
holds real-time `onSnapshot` listeners for display, and calls actions through
`src/lib/run-action.ts`.

**Result envelope.** Actions never throw to the client; they return
`{ ok: true, data }` or `{ ok: false, error }`. Next.js hides thrown error messages in
production, and the messages here ("That overlaps a booking by Sam at 10:00.") are the
whole point. `runAction` turns the envelope back into a thrown `LaundryError` so pages
keep their ordinary `try/catch` + toast.

### The Now screen

One line for the schedule, one row per machine, one row through to bookings. A machine
grows a second line only when it has something to say:

- **Available**: the row is just the name, a green Available badge and **Start**.
- **In use**: who started it, the cycle name, the window, a live countdown and a thin
  progress bar.
- **Finished**: the same row in amber, reading "Finished, waiting to be emptied", with an
  **Emptied** button anyone in the house can press.
- **Blocked**: Start is disabled with the reason, either someone else's booking covering
  this moment or a strict schedule day that belongs to another group.

Bookings for today sit behind a collapsed **Booked today** toggle with a count, so a free
machine stays one row. Underneath, a line says the page updates on its own and when it
last heard from the database.

### How often it updates

Data is **pushed, not polled**. Firestore keeps a connection open and sends changes as
they happen, so pressing Start on one phone turns the machine red on another in about a
second. There is no interval to tune, and no refresh button because there is nothing to
press.

Separately, each page redraws on a timer so countdowns move even when nothing in the
database has changed:

| Page     | Redraw | What moves                                      |
| -------- | ------ | ----------------------------------------------- |
| Now      | 1 s    | Countdown, progress bar, the "last change" line |
| History  | 30 s   | Relative times in the list                      |
| Bookings | 60 s   | Which start times are still in the future       |

The bookings query also re-keys at midnight, so a phone left open overnight rolls to the
new day. If nothing is heard from the server for twenty seconds the Now screen says it is
showing saved data rather than pretending to be live.

**Losing and regaining a house.** `users/{uid}.houseId` is the only pointer from a person
to their house, which makes it load-bearing: without it the app cannot find the house, and
there is no query that would (houses cannot be listed, and the rules cannot constrain a
`where` clause). Two rules protect it:

- A failed read never means "no house". A document that does not exist still arrives as an
  empty snapshot, so that is the only thing that concludes somebody has no house. Errors,
  including the ones a cleared cache or a dropped connection produce, leave the app on the
  loading screen instead of sending a long-standing member to onboarding. Every listener in
  the provider logs its errors, because a listener that silently never resolves is very
  hard to diagnose from the outside.
- The invite code is a repair tool. If the pointer is lost anyway, entering the house's
  code restores it from the member document that is already there, keeping the person's
  role, group and join date. Without this an admin could never get back in, because
  rejoining would try to demote them to `member` and the rules refuse a role change.

### Joining, and who decides

By default the invite code is the whole gate: enter it and you are in. An admin can switch
on **approval** in Settings, and then the code only produces a request, which the admin
approves or declines from the same card.

The flag lives in two places on purpose. The house document holds the setting, but a
newcomer is not allowed to read a house they are not in, so `joinHouse` reads it from the
`inviteCodes` document instead, which is the only thing they can read. `setJoinApproval`,
`updateHouseDetails` and `regenerateInviteCode` all write both copies. Reading it from the
house instead would have meant letting anyone holding a houseId see every house setting.

The gate is enforced in the rules, not just the app: with approval on, the members `create`
rule refuses a self-created membership unless an approved request exists, so knowing the
invite code is genuinely not enough.

`joinHouse` is idempotent and is also how the app checks back, so each call answers for
itself: still pending, approved and joined, declined, or already a member.

### Leaving

A member can leave from Settings. It takes their membership, their upcoming bookings with
the slot documents those held, and their notification devices. It is refused while one of
their own cycles is running, so nobody can walk out leaving a machine claimed. The admin
cannot leave at all, because the rules forbid deleting the admin's membership and a house
with no admin could never be administered again; transferring the role first would be the
way to allow it, which the app does not do yet.

### Users and houses

- The first user creates a **house** and becomes its **admin**. The house gets a
  six-character **invite code**.
- Others join with the code, pick a display name and a **group** (e.g. Upstairs /
  Downstairs).
- The admin can rename the house and groups, set the day schedule, add/rename/remove
  machines, change anyone's group, remove members, and regenerate the invite code.

### Saying when your laundry is done

Two channels, both opt-in and both aimed only at the person who started the cycle.

- **A notification on your phone.** Turn it on with the switch that appears once the app is
  installed. The browser is registered as a device (`houses/{id}/devices`), and when any
  housemate's open app notices a machine sitting finished it asks the server to notify the
  owner. The session document records that one was sent, so several phones noticing at the
  same moment still produce a single notification. This means delivery depends on somebody
  having the app open; the email below is the channel that does not.
- **An email**, scheduled at the moment you press Start (see below), which arrives whether
  or not anyone is looking at the app. It needs **two** switches, so nobody receives post
  from a washing machine by accident: the admin allows email for the house
  (`house.emailReminders`), and then each person opts in for themselves
  (`member.emailReminders`, in the account menu under Notifications). Both default to off.

**Worth knowing about delivery.** Receiving a notification does not need the app open; the
service worker wakes for it. But _sending_ one does: there is no server watching the clock,
so whichever housemate's open app first notices a finished machine is what triggers it. In
a quiet house a notification can therefore wait until somebody next opens the app. A server
that watches the clock would mean Cloud Functions and the paid plan, which is why the
scheduled email exists as the channel that does not depend on anyone looking.

Push is optional and off unless two things are set: `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (the
Web Push certificate from the Firebase console) and `FCM_SERVICE_ACCOUNT`. Give that
service account **only** the "Firebase Cloud Messaging API Admin" role: it can send
notifications and nothing else, so the rule that Firestore is only ever touched as the
signed-in user still holds. The sender is `src/server/push.ts`, which signs its own JWT
rather than pulling in the Firebase Admin SDK.

### Add to the home screen

The app is installable, and a banner says so on every page until it is. There is no
dismiss button, because on iPhone and iPad this is not a nicety: Apple only delivers web
notifications to a site that has been added to the home screen. Chrome and Edge get the
one-tap `beforeinstallprompt`; Safari and anything else get a dialog with the Share sheet
steps. Once installed, the banner is replaced by the notification switch.

Installability needs the PNG icons in `public/` and the fields in
`public/manifest.webmanifest`; the icons are generated art, not photographs, so they are
checked in rather than built.

### Reminders by email

Off by default. A new house is created with `emailReminders: false`, and the admin turns it
on in Settings. When it is on, starting a cycle hands Resend a reminder addressed to the
person who started it, scheduled for the moment the cycle ends, so the app can notify
people without a cron job or a paid Firebase plan. Stopping a cycle early tries to call the
reminder off.

- Entirely optional. With no `RESEND_API_KEY` the app behaves exactly as before, and a
  failure to reach Resend never stops someone starting a wash.
- Set `RESEND_FROM` to an address on a domain you have verified in Resend, and
  `NEXT_PUBLIC_APP_URL` so the email can link back.
- **Testing:** set `RESEND_TEST_RECIPIENT=delivered@resend.dev` and every reminder goes to
  Resend's simulator instead of a housemate. `bounced@resend.dev` and
  `complained@resend.dev` simulate the failure cases. These count against the sending
  quota; remove the variable to email real people.
- Cancelling a scheduled email needs a **full-access** key. The send-only key suggested
  here cannot, so a cycle stopped early still gets its reminder at the original finish
  time; the server logs one warning and carries on. Swap in a full-access key to enable
  cancelling, with no code change.
- Content lives in `src/lib/reminder.ts` (pure, unit tested); the network calls are in
  `src/server/resend.ts`.

### Machines

- Each machine shows **🟢 Available**, **🔴 In use** (with who, start time, expected finish and a
  countdown), or **Finished** once the expected end has passed but nobody has emptied it.
- **Start** offers the machine's named cycles (for a stock washer: Quick 30, Normal 45,
  Heavy 60; dryer: Low 40, Normal 60, Heavy 80; washer + dryer unit: Wash only 45,
  Wash + dry 150, Heavy 180) plus a custom length up to that machine's maximum. The admin
  edits the names, minutes and maximum per machine in Settings (up to six cycles, maximum
  15 to 600 minutes). The server refuses anything over the maximum, and claims the
  machine in a Firestore transaction so two people cannot start it at the same moment.
- Machines are ordered by the admin (drag in Settings); the default order is washers,
  then all-in-one units, then dryers.
- **One card per appliance you can load at the same time.** A card is a physical machine,
  not a kind of laundry: registering a washer, a dryer _and_ a "washer + dryer" describes
  the same drum twice, and the app would then show it busy on one card and free on another.
  The all-in-one type is for a house that owns a single drum which washes and dries
  _instead of_ a pair. Settings warns (but does not block) when the combination looks like
  the same appliance described twice, since a flat really can own three.
- While a cycle runs the row shows the cycle name when the length matches one of that
  machine's presets ("Mo · Heavy · 2:02 PM–3:02 PM"), plus a progress bar that fills as
  the countdown runs down and turns amber once the cycle is over.
- **Done** ends your own cycle. The admin can end any cycle. Once a cycle has finished,
  anyone can press **I emptied it**.
- Starting is refused, in the UI and again on the server, when someone else's booking
  covers that moment or when the cycle would run into one. Your own booking never blocks
  you.

### Bookings

- Booking works like starting: pick a time, then a **cycle** from that machine's own
  presets, or type a custom number of minutes. The end time is worked out for you and
  spelled out on the button ("Book 3:00 PM to 4:30 PM").
- Times are on a **15-minute grid**, up to 6 hours per booking, so a cycle whose length is
  not a multiple of 15 rounds up: an 80-minute dry books 90.
- On today's date only future start times are offered, and the list shrinks as the day
  goes on.
- **Your bookings** lists everything you have booked from now on, across every machine and
  day, so a slot next week is never hidden behind a date picker. Tapping one opens its day
  and machine.
- Overlaps are impossible, not just discouraged: the server validates the grid, the
  6-hour cap and the past, then locks the `slots` documents (see below) in a
  transaction.
- To change a booking, cancel it and book again. Members can cancel their own; the admin
  can cancel any.
- Booking on another group's day shows a soft warning but is allowed.
- Booking a **washer** offers the dryer straight afterwards: the app finds that dryer's
  first free window from the moment the wash ends (its Normal cycle, rounded onto the
  15-minute grid, skipping anything already booked) and offers it as a second, ordinary
  booking. Declining changes nothing, and the two bookings stay independent: nothing
  chains the machines together. See `proposeDryerSlot` in `src/lib/follow-up.ts`.

### Day schedule

The admin assigns each weekday to a group (or leaves it open) and picks how much that
matters, in Settings:

| Mode                                         | What it means                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free for all** (`open`)                    | Days are ignored. Anyone can start a free machine or book any slot. The banner is hidden.                                                                         |
| **Days, shared when idle** (`soft`, default) | Each group has first claim on its days, but an available machine can be used and booked by anyone. Booking on another group's day shows a warning, never a block. |
| **Strict days** (`strict`)                   | Only the group that owns the day can start a machine or book a slot on it. Days with no owner stay open. Nobody is exempt, the admin included.                    |

Details of strict mode:

- The **day the action starts on** decides. A booking may run past midnight into another
  group's day.
- Existing bookings are kept when strict is switched on; only new bookings follow the rule.
- "Today" is decided in the house's **time zone** (`house.timeZone`, taken from the phone
  that created the house and changeable in Settings), not the server's, which runs in UTC.
- Enforcement lives in the server actions (`dayAccess()` in `src/lib/schedule.ts`, called by
  `startSession` and `createBooking`). The UI disables the Start and Book buttons with the
  reason, and the banner turns red on a day that is not yours. Firestore rules cannot do
  time-zone arithmetic, so this rule is not duplicated there; a member who bypassed the
  app would still be limited to their own name and the usual overlap/ownership rules.

## Data model (Firestore)

```
users/{uid}
  houseId, displayName, email
  → private pointer so a signed-in person can find their house in one read
    (a member document lives under the house, which they can't query before knowing it)

inviteCodes/{code}
  houseId, houseName, groups
  → looked up by exact code on the join screen; readable by any signed-in user but
    never listable, so codes cannot be enumerated

houses/{houseId}
  name, inviteCode, adminUid, groups: [...], schedule: { mon: "Upstairs", …, sun: null },
  scheduleMode: "open" | "soft" | "strict", timeZone: "America/Chicago", createdAt

houses/{houseId}/members/{uid}
  displayName, email, group, role: "admin" | "member", joinedAt

houses/{houseId}/machines/{machineId}
  name, type: "washer" | "dryer" | "combo", status: "free" | "in_use",
  currentSession: { uid, displayName, startedAt, expectedEndAt } | null  → null = no record
  cycles: [{ name: "Normal", minutes: 45 }, …], maxMinutes: 120, order: 0

houses/{houseId}/bookings/{bookingId}
  machineId, uid, displayName, startAt, endAt, createdAt
  → deleted automatically once endAt has passed

houses/{houseId}/slots/{machineId_slotIndex}
  bookingId, machineId, uid, displayName, startAt, endAt, slotIndex
  → one lock document per 15-minute slot a booking occupies. The Firestore client SDK
    cannot run queries inside a transaction, but it can read deterministically named
    documents. Creating a booking reads every slot document it needs inside a
    transaction and aborts if any already exists; the rules additionally forbid
    overwriting a slot. That is what makes overlapping bookings impossible even when
    two phones submit at the same instant. `slotIndex` is derived from the epoch (not
    wall-clock time) so daylight-saving changes cannot cause collisions.

houses/{houseId}/sessions/{sessionId}
  machineId, uid, displayName, startedAt, expectedEndAt, endedAt | null
  → the laundry log; entries older than 7 days are deleted automatically
```

## Security model

The rules live in `firestore.rules`.

- Nothing is readable or writable without signing in.
- A house's documents are readable only by its members.
- **Knowing a houseId is the invitation.** House ids are random 20-character Firestore
  ids that appear nowhere public; the only way to learn one is the invite code, which is
  fetchable by exact match but never listable. A signed-in user can therefore create
  their own member document in a house whose id they know. Regenerating the invite code
  invalidates the old one.
- Server actions act as the signed-in user, never as an admin SDK, so every rule below
  applies to them exactly as it does to the browser's listeners.
- Members can only claim a **free** machine for themselves, and can only free a machine
  they started, unless the cycle has finished, in which case anyone may free it.
- Members can create bookings and slot locks only in their own name, and delete only
  their own (the admin can delete any). Bookings and slots can never be updated in place.
- Only the admin can change house settings, the schedule, machines and other members.
  Nobody can change roles.

## Scripts

| Command              | What it does                                   |
| -------------------- | ---------------------------------------------- |
| `npm run dev`        | Start the dev server                           |
| `npm run build`      | Production build                               |
| `npm run start`      | Serve the production build                     |
| `npm run lint`       | ESLint                                         |
| `npm test`           | Unit tests (vitest)                            |
| `npm run test:rules` | Rules + server-logic tests on the emulator     |
| `npm run emulators`  | Start Auth + Firestore emulators (UI on :4000) |

## License

[MIT](LICENSE). Provided as is, without warranty; see the license text for the full
disclaimer.
