import "server-only";

import webpush from "web-push";
import type { PushPayload, PushTarget } from "@/lib/push-message";

/**
 * Standard Web Push, signed with this app's own VAPID key pair. No Firebase Messaging
 * and no service account: the push services only need to know the message came from
 * whoever holds the private key that matches the public one the browser subscribed with.
 */
function vapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  // Push services want a way to reach the sender if something goes wrong.
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:laundry@example.com";
  return { publicKey, privateKey, subject };
}

/** Optional, like email: with no keys the app simply never sends a notification. */
export function pushConfigured(): boolean {
  return vapid() !== null;
}

/**
 * Sends one notification to each device. Returns the endpoints the push service says are
 * gone (the person turned notifications off, or reinstalled), so a caller that can write
 * the database may forget them.
 *
 * Never throws: a notification problem must not break whatever triggered it.
 */
export async function sendPush(
  targets: PushTarget[],
  payload: PushPayload,
): Promise<{ sent: number; gone: string[] }> {
  const keys = vapid();
  if (!keys || targets.length === 0) return { sent: 0, gone: [] };

  const body = JSON.stringify(payload);
  const results = await Promise.all(
    targets.map(async (target) => {
      try {
        await webpush.sendNotification(target, body, {
          vapidDetails: keys,
          // A reminder that cannot be delivered within the hour is no longer useful.
          TTL: 60 * 60,
          urgency: "high",
        });
        return "sent" as const;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return "gone" as const;
        console.error("push: could not deliver", status, error);
        return "failed" as const;
      }
    }),
  );

  return {
    sent: results.filter((r) => r === "sent").length,
    gone: targets.filter((_, i) => results[i] === "gone").map((t) => t.endpoint),
  };
}
