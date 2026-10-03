import "server-only";

import { bookingSoonEmail, cycleDoneEmail, testEmail } from "@/emails/build";
import type { ReminderContent } from "@/lib/reminder";

const ENDPOINT = "https://api.resend.com/emails";

interface ResendConfig {
  apiKey: string;
  from: string;
  /** When set, every reminder goes here instead of the housemate. For testing only. */
  testRecipient: string | null;
  appUrl: string;
}

/**
 * Reminders are optional: with no key configured the app behaves exactly as before, so a
 * fork or a local checkout never has to care about email.
 */
function config(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  // A deployment-wide default; each house can override it in settings.
  const from = process.env.RESEND_FROM?.trim() ?? "";

  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
  return {
    apiKey,
    from,
    testRecipient: process.env.RESEND_TEST_RECIPIENT?.trim() || null,
    appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || vercel,
  };
}

export function remindersEnabled(): boolean {
  return config() !== null;
}

interface EmailTo {
  to: string;
  /** The house's own sender; falls back to the deployment default. */
  from?: string;
}

/**
 * Hands Resend an email now and lets it deliver at `at`, which is how the app can remind
 * people without a cron job or a paid Firebase plan. Returns the id needed to call it off,
 * or null when nothing was scheduled.
 *
 * Never throws: an email problem must not stop someone starting a wash or booking.
 */
async function scheduleEmail(
  input: EmailTo,
  /** Null sends straight away. */
  at: Date | null,
  build: (appUrl: string) => Promise<ReminderContent>,
): Promise<string | null> {
  const cfg = config();
  if (!cfg) return null;
  const from = input.from?.trim() || cfg.from;
  if (!from) return null;

  const to = cfg.testRecipient ?? input.to.trim();
  if (!to) return null;

  try {
    const { subject, text, html } = await build(cfg.appUrl);
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html,
        ...(at ? { scheduled_at: at.toISOString() } : {}),
      }),
    });

    if (!response.ok) {
      console.error(
        "resend: could not schedule an email",
        response.status,
        await response.text(),
      );
      return null;
    }

    const data = (await response.json()) as { id?: string };
    return data.id ?? null;
  } catch (error) {
    console.error("resend: could not schedule an email", error);
    return null;
  }
}

/** "Your laundry is done", delivered when the cycle ends. */
export function scheduleCycleReminder(
  input: EmailTo & {
    displayName: string;
    machineName: string;
    houseName: string;
    finishesAt: Date;
    timeZone?: string;
    /** The machine's colour, for the stripe across the top. */
    accent?: string;
  },
): Promise<string | null> {
  return scheduleEmail(input, input.finishesAt, (appUrl) =>
    cycleDoneEmail({ ...input, appUrl }),
  );
}

/** "Your booking starts in 15 minutes", delivered at `at`. */
export function scheduleBookingReminder(
  input: EmailTo & {
    displayName: string;
    machineName: string;
    houseName: string;
    startsAt: Date;
    endsAt: Date;
    timeZone?: string;
    accent?: string;
  },
  at: Date,
): Promise<string | null> {
  return scheduleEmail(input, at, (appUrl) => bookingSoonEmail({ ...input, appUrl }));
}

/**
 * Sends the settings test straight away, through exactly the path the reminders use, so
 * a delivered test means the reminders will be delivered too. Returns the address it
 * really went to (the test inbox, when one is configured), or null when Resend refused.
 */
export async function sendTestEmail(
  input: EmailTo & { displayName: string; houseName: string },
): Promise<string | null> {
  const sent = await scheduleEmail(input, null, (appUrl) =>
    testEmail({ ...input, appUrl }),
  );
  return sent === null ? null : (config()?.testRecipient ?? input.to.trim());
}

let warnedAboutRestrictedKey = false;

/**
 * Called when a cycle is stopped before its time or a booking is cancelled, so the
 * reminder never lands.
 *
 * Resend only allows this on a full-access key. With the send-only key recommended in
 * `.env.example` the call is refused, the pending email still goes out at the original
 * finish time, and everything else keeps working. Swapping in a full-access key turns
 * cancelling on with no code change.
 */
export async function cancelScheduledEmail(
  id: string,
  ownerEmail: string,
): Promise<void> {
  const cfg = config();
  if (!cfg) return;

  try {
    // The id comes from a document every member can read, so check it really is this
    // person's email before calling it off; otherwise a copied id could silence a
    // housemate's reminder. A send-only key cannot look, and could not cancel either.
    const lookup = await fetch(`${ENDPOINT}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (lookup.ok) {
      const email = (await lookup.json()) as { to?: string[] };
      const expected = (cfg.testRecipient ?? ownerEmail).trim().toLowerCase();
      if (!email.to?.some((to) => to.trim().toLowerCase() === expected)) {
        console.warn("resend: refusing to cancel an email that is not this person's");
        return;
      }
    }

    const response = await fetch(`${ENDPOINT}/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });

    if (response.status === 401 && !warnedAboutRestrictedKey) {
      warnedAboutRestrictedKey = true;
      console.warn(
        "resend: this API key can send but not cancel, so a reminder for a cycle that " +
          "ended early will still arrive. Use a full-access key to cancel them.",
      );
      return;
    }
    if (!response.ok) {
      console.error("resend: could not cancel reminder", response.status);
    }
  } catch (error) {
    // A reminder that arrives after the machine was emptied is a nuisance, not a fault.
    console.error("resend: could not cancel reminder", error);
  }
}
