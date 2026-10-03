import type { Machine } from "@/lib/types";

/**
 * Handed out in order to machines that have no colour of their own yet, and offered as
 * the starting point when one is added. The admin can pick any colour afterwards.
 */
export const DEFAULT_MACHINE_COLORS = [
  "#2563eb",
  "#c2410c",
  "#7c3aed",
  "#0f766e",
  "#be185d",
  "#475569",
];

/**
 * Colours that already mean something in the app: free slots, a running cycle and a
 * finished one. A machine painted like them would read as a status.
 */
const RESERVED = [
  { hex: "#059669", meaning: "the green used for free slots" },
  { hex: "#dc2626", meaning: 'the red used for "in use"' },
  { hex: "#f59e0b", meaning: 'the amber used for "finished"' },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** Lower-case `#rrggbb`, accepting a missing `#`; null when it is not a colour. */
export function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return isHexColor(withHash) ? withHash.toLowerCase() : null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or near-black, whichever reads better on top of `hex`. */
export function textOn(hex: string): "#ffffff" | "#171717" {
  const l = luminance(hex);
  // Contrast against white vs against #171717 (luminance ~0.0089).
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0589 ? "#ffffff" : "#171717";
}

function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

const TOO_CLOSE = 70;

/**
 * A sentence explaining why `hex` may be hard to tell apart on the calendar, or null.
 * Advice only: a house may well want two machines in the same colour.
 */
export function colorWarning(
  hex: string,
  others: { name: string; color: string }[],
): string | null {
  if (!isHexColor(hex)) return null;
  const twin = others.find(
    (o) => isHexColor(o.color) && distance(o.color, hex) < TOO_CLOSE,
  );
  if (twin) {
    return `Looks a lot like ${twin.name}. Pick something further apart so the two are easy to tell apart.`;
  }
  const reserved = RESERVED.find((r) => distance(r.hex, hex) < TOO_CLOSE);
  if (reserved) return `Close to ${reserved.meaning}, so its bookings may be confusing.`;
  return null;
}

/**
 * Every machine's colour, keyed by id. Machines saved before colours existed get the
 * defaults in display order, skipping colours other machines already chose.
 */
export function machineColors(machines: Machine[]): Record<string, string> {
  const taken = new Set(machines.map((m) => m.color).filter(isHexColor));
  const spare = DEFAULT_MACHINE_COLORS.filter((c) => !taken.has(c));
  const colors: Record<string, string> = {};
  let next = 0;
  machines.forEach((machine, index) => {
    colors[machine.id] = isHexColor(machine.color)
      ? machine.color
      : (spare[next++] ?? DEFAULT_MACHINE_COLORS[index % DEFAULT_MACHINE_COLORS.length]);
  });
  return colors;
}

/** The first default nobody uses yet: what the colour field starts on for a new machine. */
export function suggestColor(machines: Machine[]): string {
  const used = new Set(Object.values(machineColors(machines)));
  return DEFAULT_MACHINE_COLORS.find((c) => !used.has(c)) ?? DEFAULT_MACHINE_COLORS[0];
}

/**
 * Inline styles for a booking block. Someone else's booking is a tint mixed against the
 * card colour, so it works in dark mode without a second palette.
 */
export function blockStyle(hex: string, mine: boolean): React.CSSProperties {
  return mine
    ? { backgroundColor: hex, color: textOn(hex) }
    : {
        backgroundColor: `color-mix(in oklab, ${hex} 20%, var(--card))`,
        color: `color-mix(in oklab, ${hex} 55%, var(--foreground))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${hex} 45%, transparent)`,
      };
}
