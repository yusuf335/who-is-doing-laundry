import "server-only";

import { Client } from "@upstash/qstash";
import type { PushDelivery } from "@/lib/push-message";
import { pushConfigured } from "@/server/push";

/**
 * Delivery at a set time, without a cron job or a paid Firebase plan: QStash holds the
 * message and calls `/api/notify` when it is due. The message carries the devices and the
 * text, so the endpoint never needs to read the database and the app keeps having no
 * admin key. The same shape as the scheduled email from Resend.
 */

/** The app's public addresses, the configured one first. */
function publicBases(): string[] {
  const bases = [
    process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "",
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "",
  ]
    .filter((base) => base.startsWith("https://"))
    .map((base) => base.replace(/\/$/, ""));
  return [...new Set(bases)];
}

/** Where QStash should call back. It must be public, so local development skips this. */
export function notifyUrl(): string | null {
  const base = publicBases()[0];
  return base ? `${base}/api/notify` : null;
}

/**
 * Every address a genuine message may have been signed for. A preview deployment has no
 * NEXT_PUBLIC_APP_URL and so schedules against the production URL Vercel reports, which
 * can differ from the configured one; production accepts both.
 */
export function acceptedNotifyUrls(): string[] {
  return publicBases().map((base) => `${base}/api/notify`);
}

function client(): Client | null {
  const token = process.env.QSTASH_TOKEN?.trim();
  if (!token) return null;
  return new Client({ token, baseUrl: process.env.QSTASH_URL?.trim() || undefined });
}

/** Whether a scheduled notification could be sent at all, so callers can skip work. */
export function schedulingConfigured(): boolean {
  return pushConfigured() && client() !== null && notifyUrl() !== null;
}

/**
 * Hands QStash a notification to deliver at `deliverAt`. Returns the id needed to call
 * it off, or null when nothing was scheduled.
 *
 * Never throws: a notification problem must not stop someone starting a wash.
 */
export async function schedulePush(
  deliverAt: Date,
  delivery: PushDelivery,
): Promise<string | null> {
  const qstash = client();
  const url = notifyUrl();
  if (!qstash || !url || !pushConfigured() || delivery.targets.length === 0) return null;

  try {
    const result = await qstash.publishJSON({
      url,
      body: delivery,
      notBefore: Math.floor(deliverAt.getTime() / 1000),
      // A reminder sent twice is worse than one that is a minute late.
      retries: 2,
    });
    return result.messageId;
  } catch (error) {
    console.error("qstash: could not schedule a notification", error);
    return null;
  }
}

/**
 * Called when the cycle ends early or the booking is cancelled, so nothing stale lands.
 *
 * The id comes from a document other members can read, so it is only trusted once the
 * message itself says it belongs here: its tag names the booking or cycle it was for.
 * Without that, anyone could copy a housemate's id onto their own booking, cancel it,
 * and silently take their reminder with it.
 */
export async function cancelPush(messageId: string, expectedTag: string): Promise<void> {
  const qstash = client();
  if (!qstash) return;
  try {
    const message = await qstash.messages.get(messageId);
    const body = message.body ? (JSON.parse(message.body) as unknown) : null;
    const tag = (body as { payload?: { tag?: unknown } } | null)?.payload?.tag;
    if (tag !== expectedTag) {
      console.warn("qstash: refusing to cancel a notification that is not this one");
      return;
    }
    await qstash.messages.cancel(messageId);
  } catch (error) {
    // Already delivered, or already gone. Either way there is nothing left to stop.
    console.error("qstash: could not cancel a notification", error);
  }
}
