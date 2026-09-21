import { formatTime } from "@/lib/time";

/**
 * Accepts `name@example.com` or `Display Name <name@example.com>`, which is what Resend
 * takes. Deliberately loose about the local part and strict about the shape.
 */
export function parseSender(
  input: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = input.trim().replace(/\s+/g, " ");
  if (!value)
    return { ok: false, error: "Enter the address the email should come from." };
  if (value.length > 200) return { ok: false, error: "That address is too long." };

  const angled = /^[^<>]{1,100}<([^<>\s]+)>$/u.exec(value);
  const email = angled?.[1] ?? value;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/u.test(email)) {
    return { ok: false, error: "Use name@example.com, or Name <name@example.com>." };
  }
  return { ok: true, value };
}

export interface ReminderContent {
  subject: string;
  text: string;
  html: string;
}

/** Names come from Google profiles, so they reach the HTML body unescaped otherwise. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || "there";
}

/**
 * The one email this app sends: your own cycle has finished, go and empty it. Built as a
 * pure function so the wording can be tested without touching the network.
 */
export function cycleDoneEmail(input: {
  displayName: string;
  machineName: string;
  houseName: string;
  finishesAt: Date;
  appUrl?: string;
}): ReminderContent {
  const { machineName, houseName } = input;
  const time = formatTime(input.finishesAt);
  const link = input.appUrl?.trim() ?? "";

  const subject = `Your laundry is done: ${machineName}`;

  const lines = [
    `Hi ${firstName(input.displayName)},`,
    "",
    `Your ${machineName} at ${houseName} finished at ${time}.`,
    "",
    "Empty it when you can so the next person gets a turn, then mark it available in the app.",
  ];
  if (link) lines.push("", link);
  lines.push("", "You get this because you started the cycle. Nobody else was emailed.");

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111">
  <p>Hi ${escapeHtml(firstName(input.displayName))},</p>
  <p>Your <strong>${escapeHtml(machineName)}</strong> at ${escapeHtml(houseName)} finished at <strong>${time}</strong>.</p>
  <p>Empty it when you can so the next person gets a turn, then mark it available in the app.</p>
  ${link ? `<p><a href="${escapeHtml(link)}" style="color:#0b7a54">Open the laundry app</a></p>` : ""}
  <p style="color:#667;font-size:13px">You get this because you started the cycle. Nobody else was emailed.</p>
</div>`;

  return { subject, text: lines.join("\n"), html };
}
