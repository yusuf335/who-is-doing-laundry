import { describe, expect, it } from "vitest";
import {
  DEFAULT_CYCLES,
  DEFAULT_MAX_MINUTES,
  cyclesOf,
  maxMinutesOf,
  machineTypeWarning,
  sortMachines,
  type Machine,
} from "@/lib/types";

const m = (id: string, type: Machine["type"], order?: number): Machine => ({
  id,
  name: id,
  type,
  status: "free",
  currentSession: null,
  ...(order === undefined ? {} : { order }),
});

describe("sortMachines", () => {
  it("defaults to washer, combo, dryer, then name", () => {
    const sorted = sortMachines([
      m("Dryer", "dryer"),
      m("Unit", "combo"),
      m("Washer", "washer"),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["Washer", "Unit", "Dryer"]);
  });

  it("lets an explicit order override the default", () => {
    const sorted = sortMachines([m("Washer", "washer", 1), m("Dryer", "dryer", 0)]);
    expect(sorted.map((x) => x.id)).toEqual(["Dryer", "Washer"]);
  });

  it("puts unordered machines after ordered ones", () => {
    const sorted = sortMachines([m("New washer", "washer"), m("Dryer", "dryer", 0)]);
    expect(sorted.map((x) => x.id)).toEqual(["Dryer", "New washer"]);
  });

  it("does not mutate its input", () => {
    const input = [m("B", "dryer"), m("A", "washer")];
    sortMachines(input);
    expect(input.map((x) => x.id)).toEqual(["B", "A"]);
  });
});

describe("cyclesOf / maxMinutesOf", () => {
  it("falls back to the type defaults when the fields are missing", () => {
    const washer = m("Washer", "washer");
    expect(cyclesOf(washer)).toEqual(DEFAULT_CYCLES.washer);
    expect(cyclesOf(washer)).toHaveLength(3);
    expect(cyclesOf(washer)).toContainEqual({ name: "Normal", minutes: 45 });
    expect(maxMinutesOf(washer)).toBe(120);
    expect(maxMinutesOf(m("Dryer", "dryer"))).toBe(120);
    expect(maxMinutesOf(m("Unit", "combo"))).toBe(240);
    expect(maxMinutesOf(m("Unit", "combo"))).toBe(DEFAULT_MAX_MINUTES.combo);
  });

  it("treats an empty cycles list as missing", () => {
    expect(cyclesOf({ ...m("Washer", "washer"), cycles: [] })).toEqual(
      DEFAULT_CYCLES.washer,
    );
  });

  it("uses explicit values when present", () => {
    const custom = [{ name: "Wool", minutes: 25 }];
    const machine = { ...m("Washer", "washer"), cycles: custom, maxMinutes: 90 };
    expect(cyclesOf(machine)).toBe(custom);
    expect(maxMinutesOf(machine)).toBe(90);
  });
});

describe("machineTypeWarning", () => {
  const washer = { name: "Washer", type: "washer" as const };
  const dryer = { name: "Dryer", type: "dryer" as const };
  const allInOne = { name: "Washer + Dryer", type: "combo" as const };

  it("says nothing for the ordinary house", () => {
    expect(machineTypeWarning("washer", [])).toBeNull();
    expect(machineTypeWarning("dryer", [washer])).toBeNull();
    expect(machineTypeWarning("washer", [washer])).toBeNull();
  });

  it("warns when an all-in-one joins a house that already has a pair", () => {
    const warning = machineTypeWarning("combo", [washer, dryer]);
    expect(warning).toContain("Washer and Dryer");
    expect(warning).toContain("separate appliance");
  });

  it("warns when a washer or dryer joins a house with an all-in-one", () => {
    expect(machineTypeWarning("washer", [allInOne])).toContain(
      "already washes and dries",
    );
    expect(machineTypeWarning("dryer", [allInOne])).toContain("dryer only if it is");
  });

  it("names every conflicting machine", () => {
    expect(machineTypeWarning("combo", [washer])).toContain("You already have Washer.");
    expect(
      machineTypeWarning("combo", [
        washer,
        { name: "Washer 2", type: "washer" as const },
        dryer,
      ]),
    ).toContain("Washer, Washer 2 and Dryer");
  });
});
