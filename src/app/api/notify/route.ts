import { Receiver } from "@upstash/qstash";
import { isPushDelivery } from "@/lib/push-message";
import { sendPush } from "@/server/push";
import { acceptedNotifyUrls } from "@/server/qstash";

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

  const { sent } = await sendPush(delivery.targets, delivery.payload);
  // Always a success once it has been tried: a retry would only send duplicates to the
  // devices that did get it. Devices that are gone are forgotten the next time their
  // owner changes their notification settings.
  return Response.json({ sent });
}
