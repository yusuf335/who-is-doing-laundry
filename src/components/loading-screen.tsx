/**
 * The app's mark, with the drum turning. Drawn from the same shapes as `app/icon.svg`
 * so the loading screen looks like the icon that was just tapped.
 */
function SpinningMark() {
  return (
    <svg viewBox="0 0 64 64" className="size-16 drop-shadow-sm" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0f172a" />
      <rect x="14" y="10" width="36" height="44" rx="6" fill="#f8fafc" />
      <circle cx="22" cy="18" r="2.5" fill="#0f172a" />
      <circle cx="30" cy="18" r="2.5" fill="#0f172a" />
      <circle cx="32" cy="36" r="12" fill="#0f172a" />
      <g className="origin-center animate-spin [animation-duration:1.6s] [transform-box:fill-box] motion-reduce:animate-none">
        <circle cx="32" cy="36" r="8" fill="#38bdf8" />
        <path
          d="M26 38a6 6 0 0 0 9 4"
          fill="none"
          stroke="#e0f2fe"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="35" cy="31" r="1.5" fill="#e0f2fe" />
      </g>
    </svg>
  );
}

/**
 * Full-screen while the app starts or a signed-in page waits for its data. It is also
 * the first thing the server sends (see the root layout), so it must stay server-safe.
 */
export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <main
      role="status"
      aria-live="polite"
      className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16"
    >
      <SpinningMark />
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-base font-semibold">Who is doing laundry?</p>
        <p className="text-muted-foreground text-sm">{label}</p>
      </div>
    </main>
  );
}
