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
