import type React from "react";
import { SymbolIcon } from "../../lib/fileIcons";

/**
 * How a pill stands: `used` already plays its part elsewhere (faded, ticked);
 * `current` is the one in effect here (accented, ticked).
 */
export type PillState = "default" | "used" | "current";

const STATES: Record<PillState, string> = {
  default: "border-neutral-600 bg-neutral-800 dark:bg-neutral-700/50 text-neutral-100 hover:border-neutral-500",
  used: "border-neutral-700 text-neutral-400",
  current: "border-blue-500 bg-blue-500/15 text-neutral-100",
};

/**
 * A property as a pill: its type's symbol and its name. The Hierarchy's
 * palette and Map Disk Folders' levels both list properties this way.
 */
export function PropertyPill({
  symbol,
  label,
  state = "default",
  className = "",
  ...rest
}: {
  symbol: string;
  label: string;
  state?: PillState;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...rest}
      className={`flex items-center gap-1 h-[22px] px-2 rounded-full border text-[12px] select-none ${STATES[state]} ${className}`}
    >
      <SymbolIcon name={symbol} size={11} fallback="•" className="shrink-0 text-neutral-400" />
      <span className="truncate">{label}</span>
      {state !== "default" && (
        <SymbolIcon name="checkmark" size={9} fallback="✓" className={`shrink-0 ${state === "current" ? "text-blue-400" : "text-neutral-500"}`} />
      )}
    </span>
  );
}

/** The dashed pill that ends a list of properties. */
export function NewPropertyPill({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 h-[22px] px-2 rounded-full border border-dashed border-neutral-600 text-[12px] text-blue-400 whitespace-nowrap hover:border-neutral-500 ${className}`}
    >
      <SymbolIcon name="plus" size={10} fallback="+" />
      New Property…
    </button>
  );
}
