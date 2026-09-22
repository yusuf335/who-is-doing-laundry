"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { useHouse } from "@/components/providers/house-provider";
import { SetupNotice } from "@/components/setup-notice";
import { StuckNotice } from "@/components/stuck-notice";
import { useNow } from "@/hooks/use-now";
import { isFirebaseConfigured } from "@/lib/firebase";
import { clearSessionCookie } from "@/lib/session-cookie";

const STUCK_AFTER_MS = 12_000;

/** Wraps every signed-in page: no house, no access, and no flash of the wrong screen. */
export function RequireHouse({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const router = useRouter();
  const { status, waitingFor, isAdmin } = useHouse();

  // A loading screen that never resolves is the shape every serious bug here has taken,
  // so it gets a deadline. After this, say what is missing instead of spinning forever.
  const now = useNow(1000);
  const [openedAt] = useState(() => Date.now());
  const stuck = status !== "ready" && now - openedAt > STUCK_AFTER_MS;

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    if (status === "signed-out") {
      // The proxy would send us straight back while the cookie is still there.
      clearSessionCookie();
      router.replace("/login");
    } else if (status === "no-house") router.replace("/onboarding");
  }, [status, router]);

  useEffect(() => {
    if (status === "ready" && adminOnly && !isAdmin) router.replace("/");
  }, [status, adminOnly, isAdmin, router]);

  if (!isFirebaseConfigured) return <SetupNotice />;
  if (stuck && status === "loading") return <StuckNotice waitingFor={waitingFor} />;
  if (status !== "ready") return <LoadingScreen />;
  if (adminOnly && !isAdmin) return <LoadingScreen label="Redirecting…" />;

  return <AppShell>{children}</AppShell>;
}
