import { IconWashMachine } from "@tabler/icons-react";

export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16">
      <IconWashMachine className="text-muted-foreground size-8 animate-spin [animation-duration:3s]" />
      <p className="text-muted-foreground text-sm">{label}</p>
    </main>
  );
}
