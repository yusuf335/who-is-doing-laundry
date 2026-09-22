import { IconAlertTriangle } from "@tabler/icons-react";

/**
 * Stands in for an empty state when the read actually failed. Without this a denied or
 * broken query renders as "nothing booked yet", which sends people looking for a problem
 * that is not there.
 */
export function LoadError({ what }: { what: string }) {
  return (
    <p className="flex items-start gap-2 py-2 text-sm text-amber-700 dark:text-amber-400">
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Could not load {what}. This is a connection or permission problem, not an empty
        list. Reloading usually fixes it.
      </span>
    </p>
  );
}
