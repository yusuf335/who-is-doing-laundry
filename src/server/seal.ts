import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Seals a small value so it can sit in a document housemates can read without them
 * learning what it is. Used for the owner's notification devices on a running cycle:
 * the person who empties the machine acts as themselves and cannot read the owner's
 * device list, but the server can open the seal to tell the owner.
 *
 * The key is derived from the VAPID private key, a server-only secret that already
 * exists, so there is no second secret to manage.
 */
function key(): Buffer | null {
  const secret = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!secret) return null;
  return Buffer.from(hkdfSync("sha256", secret, "laundry-seal", "push-devices-v1", 32));
}

/**
 * `context` is bound into the seal (as authenticated data): it only opens with the same
 * context. Sealing the owner's devices with their uid and cycle id means a copy pasted
 * onto someone else's cycle opens to nothing.
 */
export function seal(value: unknown, context: string): string | null {
  const k = key();
  if (!k) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), body]
    .map((part) => part.toString("base64url"))
    .join(".");
}

/** The sealed value, or null when it is missing, tampered with, or from another key. */
export function unseal(sealed: unknown, context: string): unknown {
  const k = key();
  if (!k || typeof sealed !== "string") return null;
  const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(context, "utf8"));
    const text = Buffer.concat([decipher.update(body), decipher.final()]).toString(
      "utf8",
    );
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
