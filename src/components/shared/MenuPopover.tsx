import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MenuEntry } from "../../lib/nativeMenu";
import { SymbolIcon } from "../../lib/fileIcons";

interface Props {
  /** The button the popover drops down from. Clicks on it are left to its own handler. */
  anchor: HTMLElement;
  entries: MenuEntry[];
  onClose: () => void;
}

/** Gap between the anchor and the popover, and from the window edges. */
const MARGIN = 6;

/**
 * A menu-styled panel for ticking several options in a row. Native menus close
 * on every click, so like Finder's View Options this stays open until you click
 * away or press Escape. Check items toggle in place; plain items run and close.
 */
export default function MenuPopover({ anchor, entries, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number; maxHeight: number } | null>(null);

  // Drop down from the anchor, right edges aligned, never past the window bottom
  useLayoutEffect(() => {
    function place() {
      const r = anchor.getBoundingClientRect();
      const top = r.bottom + MARGIN;
      setPos({
        top,
        right: Math.max(MARGIN, window.innerWidth - r.right),
        maxHeight: window.innerHeight - top - MARGIN,
      });
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [anchor, onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={pos}
      className="fixed z-50 min-w-[200px] overflow-y-auto p-[5px] rounded-[12px] bg-neutral-900/80 dark:bg-neutral-800/80 backdrop-blur-2xl backdrop-saturate-150 border border-neutral-700/60 shadow-xl text-body text-neutral-100"
    >
      {entries.map((entry, i) => {
        if (entry.type === "separator") {
          return <div key={i} className="mx-2.5 my-[5px] h-px bg-neutral-700/80" />;
        }
        if (entry.type === "submenu") return null;
        const enabled = entry.enabled ?? true;
        return (
          <button
            key={i}
            type="button"
            role={entry.type === "check" ? "menuitemcheckbox" : "menuitem"}
            aria-checked={entry.type === "check" ? entry.checked : undefined}
            disabled={!enabled}
            onClick={() => {
              entry.action();
              if (entry.type === "item") onClose();
            }}
            className="w-full h-6 flex items-center gap-1 pl-1.5 pr-4 rounded-[6px] text-left whitespace-nowrap enabled:hover:bg-blue-500 enabled:hover:text-white disabled:text-neutral-500"
          >
            <span className="w-4 flex justify-center shrink-0">
              {entry.type === "check" && entry.checked && (
                <SymbolIcon name="checkmark" size={11} fallback="✓" />
              )}
            </span>
            {entry.text}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
