import { describe, expect, it } from "vitest";
import { isDifferentUser } from "@/lib/local-cache";

describe("isDifferentUser", () => {
  it("is false on a first sign-in, because nothing was inherited", () => {
    expect(isDifferentUser("alice", null)).toBe(false);
  });

  it("is false when the same person signs in again", () => {
    expect(isDifferentUser("alice", "alice")).toBe(false);
  });

  it("is true when somebody else signs in on this browser", () => {
    expect(isDifferentUser("bob", "alice")).toBe(true);
  });

  it("treats an empty stored value as a real value, not as absent", () => {
    // Guards against a blank write ever being mistaken for "nobody has signed in".
    expect(isDifferentUser("alice", "")).toBe(true);
  });
});
