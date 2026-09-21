import { IconAlertTriangle } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Shown instead of the app when `.env.local` has not been filled in yet. */
export function SetupNotice() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <Alert variant="destructive">
        <IconAlertTriangle />
        <AlertTitle>Firebase isn&apos;t configured yet</AlertTitle>
        <AlertDescription>
          <p>
            Copy <code className="font-mono">.env.example</code> to{" "}
            <code className="font-mono">.env.local</code>, paste in the web app config
            from your Firebase project, then restart the dev server.
          </p>
          <p>See the README for the full setup checklist.</p>
        </AlertDescription>
      </Alert>
    </main>
  );
}
