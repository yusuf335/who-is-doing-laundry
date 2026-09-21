import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/firebase-config";

/**
 * An optimistic gate: the cookie's presence decides where a request lands before any
 * page code runs, which removes the loading-screen-then-redirect flash. The token is
 * NOT verified here. That happens in the root layout (FirebaseServerApp) and, for every
 * read and write, in the Firestore security rules.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);

  const isPublic = pathname === "/login" || pathname === "/privacy";
  if (!signedIn && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (signedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Every page route; skips Next internals and static files (anything with an extension).
  matcher: ["/((?!_next|.*\\..*).*)"],
};
