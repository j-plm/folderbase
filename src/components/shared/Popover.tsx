import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** The element the popover drops down from. Clicks on it are left to its own handler. */
  anchor: HTMLElement;
  onClose: () => void;
  /** Which edges line up with the anchor: "start" left edges, "end" right edges. */
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}

/** Gap between the anchor and the popover, and from the window edges. */
const MARGIN = 6;

/**
 * A popover panel (NSPopover-like) for small forms: adding a property, filter
 * and sort rules, picking list values. Closes on a click outside or Escape;
 * unlike MenuPopover it stays open when the window loses focus, so native
 * <select> menus inside it don't dismiss it.
 */
export default function Popover({ anchor, onClose, align = "start", className = "", children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    function place() {
      const r = anchor.getBoundingClientRect();
      const height = ref.current?.offsetHeight ?? 0;
      // Open upward when there isn't room below
      const below = window.innerHeight - r.bottom - MARGIN * 2;
      const top = height > below && r.top > below ? Math.max(MARGIN, r.top - MARGIN - height) : r.bottom + MARGIN;
      const horizontal =
        align === "end"
          ? { right: Math.max(MARGIN, window.innerWidth - r.right) }
          : { left: Math.max(MARGIN, Math.min(r.left, window.innerWidth - MARGIN - (ref.current?.offsetWidth ?? 0))) };
      setPos({ top, maxHeight: window.innerHeight - top - MARGIN, ...horizontal });
    }
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor, align]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      // Invisible (not hidden) while measuring, so fields inside can take focus on mount
      style={pos ?? { opacity: 0, top: 0, left: 0 }}
      className={`fixed z-50 overflow-y-auto rounded-[12px] bg-neutral-900/80 dark:bg-neutral-800/80 backdrop-blur-2xl backdrop-saturate-150 border border-neutral-700/60 shadow-xl text-body text-neutral-100 ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}

/** A native-looking pop-up button (<select>), sized for popover forms. */
export const popoverSelect =
  "h-[22px] pl-1.5 pr-1 rounded-[5px] bg-neutral-800 dark:bg-neutral-700/70 border border-neutral-700 text-[13px] text-neutral-100 outline-none focus:border-blue-500";

/** A text field sized to sit beside popoverSelect. */
export const popoverField =
  "h-[22px] px-1.5 rounded-[5px] bg-neutral-900 border border-neutral-600/70 text-[13px] text-neutral-100 outline-none focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/40";
