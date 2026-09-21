import { describe, expect, it } from "vitest";
import { generateInviteCode, normaliseInviteCode } from "@/lib/invite";

describe("generateInviteCode", () => {
  it("is six unambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      expect(code).not.toMatch(/[0O1I]/);
    }
  });

  it("respects a custom length", () => {
    expect(generateInviteCode(10)).toHaveLength(10);
  });

  it("is not constant", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateInviteCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("normaliseInviteCode", () => {
  it("uppercases and strips everything that is not a letter or digit", () => {
    expect(normaliseInviteCode("  ab-c 2_34\n")).toBe("ABC234");
    expect(normaliseInviteCode("xyz789")).toBe("XYZ789");
    expect(normaliseInviteCode("")).toBe("");
  });
});
