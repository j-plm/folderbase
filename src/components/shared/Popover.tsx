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
 * Where a panel of this size goes under `r`, as an NSPopover or pop-down menu
 * would place it: below, else above, else slid up over the anchor so all of it
 * stays in the window. Only a panel taller than the window scrolls.
 */
export function fitToWindow(r: DOMRect, width: number, height: number, align: "start" | "end"): CSSProperties {
  const { innerWidth, innerHeight } = window;
  let top: number;
  if (r.bottom + MARGIN + height <= innerHeight - MARGIN) top = r.bottom + MARGIN;
  else if (r.top - MARGIN - height >= MARGIN) top = r.top - MARGIN - height;
  else top = Math.max(MARGIN, innerHeight - MARGIN - height);
  const wanted = align === "end" ? r.right - width : r.left;
  const left = Math.max(MARGIN, Math.min(wanted, innerWidth - MARGIN - width));
  return { top, left, maxHeight: innerHeight - top - MARGIN };
}

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
      const el = ref.current;
      const r = anchor.getBoundingClientRect();
      // Full content height, not the height a previous maxHeight squeezed it to
      const height = el ? el.scrollHeight + el.offsetHeight - el.clientHeight : 0;
      const width = el?.offsetWidth ?? 0;
      setPos(fitToWindow(r, width, height, align));
    }
    place();
    const observer = new ResizeObserver(place);
    // The panel itself stops resizing once it hits maxHeight; its contents don't
    if (ref.current) [ref.current, ...ref.current.children].forEach((el) => observer.observe(el));
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
      // A field inside that uses Escape itself (cancelling a rename) keeps the popover open
      if ((e.target as HTMLElement | null)?.closest?.("[data-own-escape]")) return;
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
