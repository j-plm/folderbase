// The parts every notice in the window's corner shares (zips, refreshes, copies):
// a macOS notification banner's card and its one push button.

/** A notice's card. */
export const NOTICE_CLASS =
  "group relative pointer-events-auto flex items-center gap-2.5 pl-3 pr-3 py-2.5 rounded-2xl border border-neutral-700/60 bg-neutral-800 shadow-lg text-[13px] select-none";

/** The banner's one button, a small push button as notifications have. */
export function PushButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 whitespace-nowrap h-[22px] px-2.5 rounded-[6px] bg-neutral-700/70 text-[12px] text-neutral-100 active:bg-neutral-700"
    >
      {children}
    </button>
  );
}
