import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const HOUSE = "house1";
const ADMIN = "admin1";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-laundry",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(db, "houses", HOUSE), {
      name: "Test house",
      inviteCode: "ABC234",
      adminUid: ADMIN,
      groups: ["Upstairs"],
      schedule: {},
    });
    await setDoc(doc(db, "houses", HOUSE, "members", ADMIN), {
      displayName: "Admin",
      email: "a@example.com",
      group: "Upstairs",
      role: "admin",
    });
  });
});

describe("list queries must be bounded", () => {
  const subcollections = [
    "members",
    "machines",
    "bookings",
    "sessions",
    "slots",
    "joinRequests",
  ];

  for (const name of subcollections) {
    it(`${name}: member can list with limit <= 200`, async () => {
      const db = testEnv.authenticatedContext(ADMIN).firestore();
      await assertSucceeds(
        getDocs(query(collection(db, "houses", HOUSE, name), limit(200))),
      );
    });

    it(`${name}: listing without a limit is denied`, async () => {
      const db = testEnv.authenticatedContext(ADMIN).firestore();
      await assertFails(getDocs(collection(db, "houses", HOUSE, name)));
    });

    it(`${name}: limit above 200 is denied`, async () => {
      const db = testEnv.authenticatedContext(ADMIN).firestore();
      await assertFails(
        getDocs(query(collection(db, "houses", HOUSE, name), limit(201))),
      );
    });
  }

  it("houses can never be listed, even bounded", async () => {
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertFails(getDocs(query(collection(db, "houses"), limit(10))));
  });
});
