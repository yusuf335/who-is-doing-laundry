import { describe, expect, it } from "vitest";
import {
  DEFAULT_MACHINE_COLORS,
  colorWarning,
  isHexColor,
  machineColors,
  normalizeHex,
  suggestColor,
  textOn,
} from "@/lib/machine-color";
import type { Machine } from "@/lib/types";

const m = (id: string, color?: string): Machine => ({
  id,
  name: id,
  type: "washer",
  status: "free",
  currentSession: null,
  ...(color ? { color } : {}),
});

describe("hex parsing", () => {
  it("accepts #rrggbb only", () => {
    expect(isHexColor("#12ab9F")).toBe(true);
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });

  it("normalises case and a missing #", () => {
    expect(normalizeHex(" 12AB9F ")).toBe("#12ab9f");
    expect(normalizeHex("#12AB9F")).toBe("#12ab9f");
    expect(normalizeHex("javascript:alert(1)")).toBeNull();
  });
});

describe("textOn", () => {
  it("picks white on dark and near-black on light colours", () => {
    expect(textOn("#1e3a8a")).toBe("#ffffff");
    expect(textOn("#2563eb")).toBe("#ffffff");
    expect(textOn("#fde047")).toBe("#171717");
    expect(textOn("#ffffff")).toBe("#171717");
  });
});

describe("machineColors", () => {
  it("keeps chosen colours and fills the rest with unused defaults", () => {
    const colors = machineColors([m("a", DEFAULT_MACHINE_COLORS[0]), m("b"), m("c")]);
    expect(colors).toEqual({
      a: DEFAULT_MACHINE_COLORS[0],
      b: DEFAULT_MACHINE_COLORS[1],
      c: DEFAULT_MACHINE_COLORS[2],
    });
  });

  it("ignores a stored value that is not a colour", () => {
    expect(machineColors([m("a", "nope")]).a).toBe(DEFAULT_MACHINE_COLORS[0]);
  });

  it("suggests the first default nobody has", () => {
    expect(suggestColor([m("a", DEFAULT_MACHINE_COLORS[0])])).toBe(
      DEFAULT_MACHINE_COLORS[1],
    );
  });
});

describe("colorWarning", () => {
  it("warns when a colour is close to another machine's", () => {
    expect(colorWarning("#2664ea", [{ name: "Washer", color: "#2563eb" }])).toMatch(
      /Washer/,
    );
  });

  it("warns when a colour looks like a status colour", () => {
    expect(colorWarning("#069a6a", [])).toMatch(/free slots/);
  });

  it("stays quiet for a distinct colour", () => {
    expect(colorWarning("#7c3aed", [{ name: "Washer", color: "#2563eb" }])).toBeNull();
  });
});
