import "server-only";

import { cycleDoneEmail } from "@/lib/reminder";

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

/**
 * Hands Resend the reminder now and lets it deliver when the cycle ends, which is how the
 * app can notify people without a cron job or a paid Firebase plan. Returns the id needed
 * to call it off if the cycle is stopped early, or null when nothing was scheduled.
 *
 * Never throws: an email problem must not stop someone starting a wash.
 */
export async function scheduleCycleReminder(input: {
  to: string;
  displayName: string;
  machineName: string;
  houseName: string;
  finishesAt: Date;
  /** The house's own sender; falls back to the deployment default. */
  from?: string;
}): Promise<string | null> {
  const cfg = config();
  if (!cfg) return null;
  const from = input.from?.trim() || cfg.from;
  if (!from) return null;

  const to = cfg.testRecipient ?? input.to.trim();
  if (!to) return null;

  const { subject, text, html } = cycleDoneEmail({ ...input, appUrl: cfg.appUrl });

  try {
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
        scheduled_at: input.finishesAt.toISOString(),
      }),
    });

    if (!response.ok) {
      console.error(
        "resend: could not schedule reminder",
        response.status,
        await response.text(),
      );
      return null;
    }

    const data = (await response.json()) as { id?: string };
    return data.id ?? null;
  } catch (error) {
    console.error("resend: could not schedule reminder", error);
    return null;
  }
}

let warnedAboutRestrictedKey = false;

/**
 * Called when a cycle is stopped before its time, so the reminder never lands.
 *
 * Resend only allows this on a full-access key. With the send-only key recommended in
 * `.env.example` the call is refused, the pending email still goes out at the original
 * finish time, and everything else keeps working. Swapping in a full-access key turns
 * cancelling on with no code change.
 */
export async function cancelScheduledEmail(id: string): Promise<void> {
  const cfg = config();
  if (!cfg) return;

  try {
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
