import type { NextConfig } from "next";

const FIREBASE_AUTH_HOST = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  ? `https://${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`
  : "";

const nextConfig: NextConfig = {
  /**
   * Serve Firebase's sign-in helper from this app's own origin.
   *
   * Firebase normally hosts it on `<project>.firebaseapp.com`, which is a different site
   * from wherever the app runs. Browsers now partition storage per site, so the helper
   * cannot hand the credential back and sign-in silently ends with nobody signed in.
   * Proxying it here makes the whole flow same-origin. It has to be a transparent proxy,
   * not a redirect, which is why these are rewrites.
   */
  async rewrites() {
    if (!FIREBASE_AUTH_HOST) return [];
    return [
      { source: "/__/auth/:path*", destination: `${FIREBASE_AUTH_HOST}/__/auth/:path*` },
      {
        source: "/__/firebase/:path*",
        destination: `${FIREBASE_AUTH_HOST}/__/firebase/:path*`,
      },
    ];
  },
};

export default nextConfig;
