import { afterEach, describe, expect, it } from "vitest";
import { pushEnabled } from "@/server/push";

const ORIGINAL = process.env.FCM_SERVICE_ACCOUNT;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FCM_SERVICE_ACCOUNT;
  else process.env.FCM_SERVICE_ACCOUNT = ORIGINAL;
});

describe("pushEnabled", () => {
  it("is off when no service account is configured", () => {
    delete process.env.FCM_SERVICE_ACCOUNT;
    expect(pushEnabled()).toBe(false);
  });

  it("stays off for a blank or unparseable value", () => {
    process.env.FCM_SERVICE_ACCOUNT = "   ";
    expect(pushEnabled()).toBe(false);
    process.env.FCM_SERVICE_ACCOUNT = "not json";
    expect(pushEnabled()).toBe(false);
  });

  it("stays off when the account is missing a required field", () => {
    process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({
      client_email: "fcm@example.iam.gserviceaccount.com",
      project_id: "demo",
    });
    expect(pushEnabled()).toBe(false);
  });

  it("is on for a complete account", () => {
    process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({
      client_email: "fcm@example.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n",
      project_id: "demo",
    });
    expect(pushEnabled()).toBe(true);
  });
});
