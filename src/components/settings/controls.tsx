import type { ReactNode } from "react";
import { SymbolIcon } from "../../lib/fileIcons";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";

/*
 * The controls of a macOS settings pane, as Finder's Settings lays them out:
 * labels right-aligned in a column ending in a colon, controls to their right,
 * notes in small grey text under the control, and Restore Defaults at the foot.
 */

/** The pane's grid of labelled rows. */
export function Form({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[minmax(150px,auto)_1fr] items-baseline gap-x-2 gap-y-3">{children}</div>;
}

/** One labelled row; `label` without its colon. Several controls stack in `children`. */
export function Row({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <>
      <span className="text-right text-neutral-100 whitespace-nowrap">{label ? `${label}:` : ""}</span>
      <div className="min-w-0 flex flex-col items-start gap-1.5">
        {children}
        {note && <p className="text-[11px] leading-snug text-neutral-400 max-w-[380px]">{note}</p>}
      </div>
    </>
  );
}

/** A hairline between groups of rows, spanning both columns. */
export function Divider() {
  return <div className="col-span-2 h-px bg-neutral-700/60 my-0.5" />;
}

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** A native pop-up button: the choice shown, its menu opening over it with the current choice under the pointer. */
export function PopUp<T extends string>({
  value,
  choices,
  onChange,
  disabled,
  icon,
  title,
  extra = [],
}: {
  value: T;
  choices: Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  icon?: ReactNode;
  title?: string;
  /** Items after a separator (Other…). */
  extra?: MenuEntry[];
}) {
  const current = choices.find((c) => c.value === value);
  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const entries: MenuEntry[] = [
      ...choices.map((c): MenuEntry => ({ type: "check", text: c.label, checked: c.value === value, key: c.value, action: () => c.value !== value && onChange(c.value) })),
      ...(extra.length > 0 ? [{ type: "separator" as const }, ...extra] : []),
    ];
    void showContextMenu(entries, { alignKey: value, event: { clientX: rect.left, clientY: rect.top + rect.height / 2 } });
  };
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={open}
      className="inline-flex items-center gap-1.5 h-[22px] pl-2 pr-1 max-w-full rounded-[6px] bg-neutral-700/70 text-neutral-100 active:bg-neutral-700 disabled:opacity-50"
    >
      {icon}
      <span className="truncate">{current?.label ?? value}</span>
      <SymbolIcon name="chevron.up.chevron.down" size={9} fallback="⌃" className="ml-1" />
    </button>
  );
}

/** A checkbox with its label to the right, as AppKit draws them. */
export function Checkbox({ checked, onChange, children, disabled }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center gap-1.5 select-none ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="accent-blue-500" />
      <span>{children}</span>
    </label>
  );
}

/** A push button, as in a sheet's footer. */
export function Button({ children, onClick, disabled, destructive }: { children: ReactNode; onClick: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-[22px] px-3 rounded-[6px] whitespace-nowrap bg-neutral-700/70 active:bg-neutral-700 disabled:text-neutral-500 ${destructive ? "text-red-500" : "text-neutral-100"}`}
    >
      {children}
    </button>
  );
}

/** The pane's foot: Restore Defaults (this pane only) at the right, anything else at the left. */
export function PaneFooter({ onRestore, children }: { onRestore?: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-5">
      {children}
      <div className="flex-1" />
      {onRestore && <Button onClick={onRestore}>Restore Defaults</Button>}
    </div>
  );
}
