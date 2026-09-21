import "server-only";

import { createSign } from "node:crypto";

/**
 * Firebase Cloud Messaging, sent with the HTTP v1 API.
 *
 * This is the one place the app uses a service account. It is deliberately a *separate*
 * account from anything that can read the database: give it only the "Firebase Cloud
 * Messaging API Admin" role, so a leaked key can send notifications and nothing else.
 * Firestore is still read and written as the signed-in user everywhere else.
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    // Vercel's environment UI turns real newlines into the two characters \ and n.
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    return parsed;
  } catch {
    console.error("fcm: FCM_SERVICE_ACCOUNT is not valid JSON");
    return null;
  }
}

export function pushEnabled(): boolean {
  return serviceAccount() !== null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Signs a JWT and swaps it for an access token, rather than pulling in a Google SDK. */
async function accessToken(account: ServiceAccount): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const issuedAt = Math.floor(Date.now() / 1000);
  const claim = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify(claim),
  )}`;

  try {
    const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${base64url(signature)}`,
      }),
    });
    if (!response.ok) {
      console.error("fcm: token exchange failed", response.status, await response.text());
      return null;
    }
    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;
    cached = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return cached.value;
  } catch (error) {
    console.error("fcm: could not mint an access token", error);
    return null;
  }
}

export interface PushMessage {
  title: string;
  body: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string;
  url?: string;
}

/**
 * Sends one notification to each token. Returns the tokens the server rejected as gone,
 * so the caller can delete them; a device that reinstalls leaves its old token behind.
 *
 * Never throws: a notification problem must not break the action that triggered it.
 */
export async function sendPush(
  tokens: string[],
  message: PushMessage,
): Promise<{ sent: number; stale: string[] }> {
  const account = serviceAccount();
  if (!account || tokens.length === 0) return { sent: 0, stale: [] };

  const token = await accessToken(account);
  if (!token) return { sent: 0, stale: [] };

  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  const stale: string[] = [];
  let sent = 0;

  await Promise.all(
    tokens.map(async (device) => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: device,
              // Data-only, so the service worker decides how it looks in every browser.
              data: {
                title: message.title,
                body: message.body,
                tag: message.tag ?? "laundry",
                url: message.url ?? "/",
              },
              webpush: {
                headers: { Urgency: "high", TTL: "1800" },
                fcm_options: { link: message.url ?? "/" },
              },
            },
          }),
        });

        if (response.ok) {
          sent += 1;
          return;
        }
        // 404 means the registration is gone for good; 403 usually means a wrong project.
        if (response.status === 404 || response.status === 400) stale.push(device);
        else console.error("fcm: send failed", response.status, await response.text());
      } catch (error) {
        console.error("fcm: send failed", error);
      }
    }),
  );

  return { sent, stale };
}
