"use client";

import { IconBrandGoogle, IconWashMachine } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LoadingScreen } from "@/components/loading-screen";
import { useAuth } from "@/components/providers/auth-provider";
import { SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { errorMessage } from "@/lib/errors";
import { isFirebaseConfigured } from "@/lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  if (!isFirebaseConfigured) return <SetupNotice />;
  if (loading || user) return <LoadingScreen />;

  async function signIn() {
    setBusy(true);
    try {
      await signInWithGoogle();
      router.replace("/");
    } catch (error) {
      toast.error(errorMessage(error, "Could not sign you in."));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <IconWashMachine className="text-primary size-9" />
        <h1 className="text-2xl font-semibold tracking-tight">Who is doing laundry?</h1>
        <p className="text-muted-foreground text-sm">
          Sign in to see whether a machine is available.
        </p>
      </div>

      <Card>
        <CardContent>
          <Button className="h-12 w-full text-base" disabled={busy} onClick={signIn}>
            <IconBrandGoogle />
            {busy ? "Signing in…" : "Continue with Google"}
          </Button>
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-4 text-center text-xs">
        Laundry history is kept for 7 days only.{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          How your data is handled
        </Link>
      </p>
    </main>
  );
}
