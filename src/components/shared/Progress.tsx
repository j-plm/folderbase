// Progress as macOS draws it: NSProgressIndicator's thin bar (filling, or a
// segment sweeping across while the total isn't known), and Finder's pie in the
// sidebar beside a disk being copied to.

/** A bar `fraction` (0–1) full, or sweeping when `fraction` is null. */
export function ProgressBar({ fraction, className = "" }: { fraction: number | null; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
      className={`relative h-1.5 overflow-hidden rounded-full bg-neutral-700 ${className}`}
    >
      {fraction === null ? (
        <div
          className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-blue-500"
          style={{ animation: "progress-sweep 1.4s ease-in-out infinite" }}
        />
      ) : (
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-blue-500 transition-[width] duration-200"
          style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
        />
      )}
    </div>
  );
}

/** Finder's sidebar pie: a ring filling clockwise. */
export function ProgressPie({ fraction, size = 14, title }: { fraction: number; size?: number; title?: string }) {
  const degrees = Math.max(0, Math.min(1, fraction)) * 360;
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      title={title}
      className="inline-block shrink-0 rounded-full border border-neutral-500"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(currentColor ${degrees}deg, transparent ${degrees}deg)`,
      }}
    />
  );
}
