# Who is doing laundry?

One laundry room, several housemates, and no way to tell from upstairs whether a machine
is free. This app answers that from a phone: what is running now, who is using it and
until when, what is booked next, and whose day it is.

Next.js (App Router, TypeScript), shadcn/ui, Firebase Auth and Cloud Firestore, on Vercel.

## Shape of the system

```
Browser
  ├── onSnapshot listeners ....... read only, live, bounded by a limit
  └── server actions ............. every write, no exceptions
        │
        ▼
Next.js server (Vercel)
  ├── proxy.ts ................... redirects on the session cookie
  ├── FirebaseServerApp .......... acts as the signed-in user, no admin keys
  └── src/server/laundry.ts ...... the house rules live here
        │
        ▼
Cloud Firestore
  └── firestore.rules ............ the last word; re-checks everything above
```

Three ideas carry the design:

- **The database has the final say.** The rules restate every limit the app enforces, so
  a hand-made request cannot sidestep the UI. Everything else is convenience on top.
- **The server has no privileges.** Each server action runs as the caller through a
  `FirebaseServerApp` built from their ID token, so the rules apply per user even on the
  server. There is no admin SDK anywhere.
- **Reads are pushed, not polled.** Listeners cost one read per document, then one per
  change. Nothing in the codebase polls Firestore.

## What it does

- **Now.** A card per machine: available, in use with a countdown, or finished and waiting
  to be emptied. Starting picks one of that machine's named cycles.
- **Bookings.** A time and a cycle, on a 15-minute grid. Booking a washer offers the dryer
  for afterwards. Overlaps are impossible by construction, not by checking.
- **Day schedule.** Weekdays belong to groups, and the admin chooses whether that is
  ignored, advisory, or strict.
- **History.** Seven days, so laundry left in a drum finds its owner, then deleted.
- **Joining.** An invite code, optionally gated by admin approval.
- **Telling you.** An email when your laundry is done, if both the admin and you switch it
  on. Both default to off.

## Data model

```
users/{uid}                    the pointer from a person to their house
inviteCodes/{code}             what a newcomer is allowed to read

houses/{houseId}               name, groups, schedule, settings, adminUid
  members/{uid}                displayName, group, role
  machines/{id}                status, currentSession, cycles, order
  bookings/{id}                machineId, uid, startAt, endAt
  slots/{machineId_slotIndex}  one lock per 15 minutes a booking holds
  sessions/{id}                the seven-day log
  joinRequests/{uid}           pending, approved or declined
```

Two choices worth knowing. Bookings cannot overlap because each one creates a lock
document per slot inside a transaction, and the rules forbid overwriting one; the same
locks tell a starting cycle that it would run into a booking. And `slotIndex` is derived
from the epoch rather than wall-clock time, so daylight saving cannot make two moments
collide.

## Design decisions

| Decision                              | Why                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google sign-in only                   | No password endpoints to attack, and no credentials to store                                                                                              |
| Writes only through server actions    | One place to enforce the house rules, and the browser never decides                                                                                       |
| Offline cache, cleared on user change | The cache is keyed by app and project, not by user, so a second Google account inherits the first's documents. Switching users throws it away and reloads |
| No Cloud Functions                    | They need the paid plan. Notifications are raised by the first open app that notices; the scheduled email covers the case where nobody is looking         |
| Vercel over Firebase App Hosting      | App Hosting needs a billing account. On Spark, abuse can exhaust the daily quota but can never produce a bill                                             |
| History kept for 7 days               | Long enough to claim a lost load, short enough not to be a record of anyone's habits                                                                      |

## Running it

```bash
cp .env.example .env.local   # Firebase web config
npm install && npm run dev
```

Firebase needs Google sign-in enabled, a Firestore database, and
`firebase deploy --only firestore:rules`. On Vercel, add the `NEXT_PUBLIC_FIREBASE_*`
variables and your domain to Firebase's authorized domains.

| Command              | What it does                                |
| -------------------- | ------------------------------------------- |
| `npm run dev`        | Dev server                                  |
| `npm run build`      | Production build                            |
| `npm test`           | Unit tests                                  |
| `npm run test:rules` | Rules and server logic against the emulator |
| `npm run emulators`  | Auth and Firestore emulators                |

Tests are the interesting part: the security rules are exercised as different users, and
the two races, claiming a machine and booking a slot, are tested rather than assumed. See
`tests/README.md`.

## Traps

Each of these cost real time and has a comment at the code.

- `users/{uid}.houseId` is the only path to a house. A failed read must never be treated
  as "no house", and clearing it strands a member for good, since an admin cannot rejoin
  without being demoted.
- Listen with `includeMetadataChanges: true`, or the cache-to-server confirmation never
  arrives and the app looks permanently offline.
- `requireApproval` is mirrored onto the invite document because a newcomer cannot read a
  house they are not in.
- The offline cache is shared by everyone who signs in on this browser, so it is cleared
  when the uid changes. A stale one reports documents you may read as missing, with no
  error to go on.
- Sign-in falls back to a full-page redirect, because browsers block popups and an
  installed app cannot open one at all.
- The session cookie must be written before anything reacts to being signed in. Publish
  the user first and a page can navigate while the cookie is still being written; the
  proxy then sees a signed-out request and bounces it back to `/login`, which reads as a
  login loop.

## License

[MIT](LICENSE). Each house runs its own copy against its own Firebase project, and the
operator of a copy is responsible for its data, not the author.
