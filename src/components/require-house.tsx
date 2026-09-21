"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { useHouse } from "@/components/providers/house-provider";
import { SetupNotice } from "@/components/setup-notice";
import { isFirebaseConfigured } from "@/lib/firebase";
import { clearSessionCookie } from "@/lib/session-cookie";

/** Wraps every signed-in page: no house, no access, and no flash of the wrong screen. */
export function RequireHouse({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const router = useRouter();
  const { status, isAdmin } = useHouse();

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
  if (status !== "ready") return <LoadingScreen />;
  if (adminOnly && !isAdmin) return <LoadingScreen label="Redirecting…" />;

  return <AppShell>{children}</AppShell>;
}
