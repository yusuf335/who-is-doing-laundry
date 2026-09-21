# Tests

## Unit tests (no Firebase needed)

```bash
npm test            # vitest run tests/unit
npm run test:watch  # watch mode
```

Covers the pure helpers in `src/lib/`: slot ids and time snapping (`time.ts`), the day
schedule rules (`schedule.ts`), invite codes (`invite.ts`) and `machineState` (`types.ts`).

## Firestore security-rules tests (need the emulator)

```bash
npm run test:rules
```

This runs `firebase emulators:exec --only firestore --project demo-laundry "vitest run tests/rules"`:
it starts the Firestore emulator, runs `tests/rules/**` against `firestore.rules`, and shuts
the emulator down again. The tests use `@firebase/rules-unit-testing` and never touch a real
project (`demo-*` project ids are emulator-only).

Two suites live there:

- `firestore.rules.test.ts` : raw reads/writes as different users, asserting what the
  rules allow and deny.
- `laundry.test.ts` : integration tests for the server-side business logic in
  `src/server/laundry.ts`. Each `ServerContext` is built from a rules-enforced emulator
  Firestore signed in as that uid, so every test proves both that the logic is right and
  that the rules permit it. Includes the two concurrency races (two people pressing
  Start, two people booking the same slot).

`vitest.config.mts` maps `server-only` to `tests/stubs/server-only.ts` so the server
modules load outside React Server Components, and sets `fileParallelism: false` because
both suites clear the same emulator project between tests.

Requirements:

- **Java 21 or newer** : `firebase-tools` 15 refuses to start the emulator on older JDKs
  and only looks at the `java` on your `PATH`, not `JAVA_HOME`. On macOS the
  `scripts/with-java.sh` wrapper (used by `npm run test:rules` and `npm run emulators`)
  picks the newest installed JDK ≥ 21 automatically, so an older default `java` is fine.
  On Linux/Windows put a JDK 21+ first on `PATH` yourself.
- First run downloads the emulator jar (~60 MB) into the Firebase cache.

To poke at the rules interactively instead: `npm run emulators` and open the Emulator UI at
http://localhost:4000, then run the app with `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`.
