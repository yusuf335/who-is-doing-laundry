import { getToken } from "firebase/app-check";
import { appCheck, auth } from "@/lib/firebase";
import { LaundryError } from "@/lib/errors";
import { writeAppCheckCookie, writeSessionCookie } from "@/lib/session-cookie";
import type { ActionResult } from "@/server/actions";

/**
 * Calls a server action from the browser. Refreshes the session cookie first so the
 * server never sees an ID token the SDK has already rotated, and turns the action's
 * result envelope back into a thrown `LaundryError` for the usual try/catch + toast.
 */
export async function runAction<T>(action: () => Promise<ActionResult<T>>): Promise<T> {
  const user = auth.currentUser;
  if (user) writeSessionCookie(await user.getIdToken());
  if (appCheck) writeAppCheckCookie((await getToken(appCheck)).token);

  const result = await action();
  if (!result.ok) throw new LaundryError(result.error);
  return result.data;
}
