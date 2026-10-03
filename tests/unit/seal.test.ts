import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seal, unseal } from "@/server/seal";

const saved = process.env.VAPID_PRIVATE_KEY;
beforeAll(() => {
  process.env.VAPID_PRIVATE_KEY = "test-secret-one";
});
afterAll(() => {
  if (saved === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = saved;
});

describe("seal", () => {
  const devices = [
    { endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } },
  ];

  it("opens what it sealed, and nobody can read it in between", () => {
    const sealed = seal(devices, "mo:s1")!;
    expect(sealed).not.toContain("push.example");
    expect(unseal(sealed, "mo:s1")).toEqual(devices);
  });

  it("opens only for the owner and cycle it was sealed for", () => {
    const sealed = seal(devices, "mo:s1")!;
    expect(unseal(sealed, "mo:s2")).toBeNull();
    expect(unseal(sealed, "ada:s1")).toBeNull();
  });

  it("opens nothing that was tampered with, or sealed under another key", () => {
    const sealed = seal(devices, "mo:s1")!;
    const [iv, tag, body] = sealed.split(".");
    expect(unseal(`${iv}.${tag}.${body.slice(0, -2)}AA`, "mo:s1")).toBeNull();
    process.env.VAPID_PRIVATE_KEY = "test-secret-two";
    expect(unseal(sealed, "mo:s1")).toBeNull();
    process.env.VAPID_PRIVATE_KEY = "test-secret-one";
    expect(unseal("not a seal", "mo:s1")).toBeNull();
    expect(unseal(undefined, "mo:s1")).toBeNull();
  });
});
