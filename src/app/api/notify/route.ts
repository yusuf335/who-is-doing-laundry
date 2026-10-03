import { Receiver } from "@upstash/qstash";
import {
  CHASE_EVERY_MINUTES,
  cycleLabel,
  isPushDelivery,
  stillWaitingPush,
} from "@/lib/push-message";
import { sendPush } from "@/server/push";
import { acceptedNotifyUrls, schedulePush } from "@/server/qstash";
import { sendRenderedEmail } from "@/server/resend";

/**
 * QStash calls this when a scheduled notification is due. Everything it needs is in the
 * signed message, so it reads no database and holds no Firebase credentials: the only
 * thing it can do is send the notification it was given.
 */
export async function POST(request: Request) {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();
  const signature = request.headers.get("upstash-signature");
  if (!currentSigningKey || !nextSigningKey || !signature) {
    return new Response("Not signed", { status: 401 });
  }

  const body = await request.text();
  // Checking the URL too means a message signed for another app cannot be replayed here.
  const receiver = new Receiver({ currentSigningKey, nextSigningKey });
  const urls = acceptedNotifyUrls();
  let verified = false;
  for (const url of urls) {
    verified = await receiver.verify({ signature, body, url }).catch(() => false);
    if (verified) break;
  }
  if (!verified) return new Response("Bad signature", { status: 401 });

  let delivery: unknown;
  try {
    delivery = JSON.parse(body);
  } catch {
    return new Response("Bad body", { status: 400 });
  }
  if (!isPushDelivery(delivery)) return new Response("Bad body", { status: 400 });

  const [{ sent, gone }] = await Promise.all([
    sendPush(delivery.targets, delivery.payload),
    delivery.email ? sendRenderedEmail(delivery.email) : null,
  ]);

  // A finished machine nobody has emptied: line up the next reminder. It carries the
  // cycle's label, so pressing Emptied cancels it along with anything else still due.
  // The chain ends when the allowance runs out or every device has gone; a device that
  // only failed this once (a busy push service) is tried again next time.
  const { chase } = delivery;
  const remaining = delivery.targets.filter((t) => !gone.includes(t.endpoint));
  if (chase && chase.remaining > 0 && remaining.length > 0) {
    const next = new Date(Date.now() + CHASE_EVERY_MINUTES * 60_000);
    await schedulePush(
      next,
      {
        payload: stillWaitingPush({
          machineName: chase.machineName,
          sessionId: chase.sessionId,
          minutesWaiting: (next.getTime() - chase.finishedAt) / 60_000,
        }),
        targets: remaining,
        chase: { ...chase, remaining: chase.remaining - 1 },
      },
      {
        label: cycleLabel(chase.sessionId),
        // QStash retries a delivery that failed after this ran; one id per step means
        // the retry cannot start a second chain beside this one.
        deduplicationId: `${cycleLabel(chase.sessionId)}-${chase.remaining - 1}`,
      },
    );
  }

  // Always a success once it has been tried: a retry would only send duplicates to the
  // devices that did get it. Devices that are gone are forgotten the next time their
  // owner changes their notification settings.
  return Response.json({ sent });
}
