import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type React from "react";

const MIN_WIDTH = 420;
const DEFAULT_WIDTH = 640;

function storedWidth(key: string, min: number, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    return n >= min ? n : fallback;
  } catch {
    return fallback;
  }
}

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Where the panel's width is kept between openings. */
  widthKey: string;
  /** Its width when first opened, and the narrowest it can be dragged (640 and 420 unless given). */
  defaultWidth?: number;
  minWidth?: number;
  onClose: () => void;
  /**
   * Closes on a press anywhere else in the window, as a popover does. Not
   * on what's portalled over the app (dialogs, popovers: they belong to the
   * panel), nor on a control marked `data-panel-toggle`, which opens and
   * closes it itself.
   */
  closeOnOutsideClick?: boolean;
  children: ReactNode;
}

/**
 * A drawer that slides in over the right of the main pane (Map Disk Folders,
 * Hierarchy), with a Done button. Drag its left edge to resize. Its width is
 * set as `--panel-width` on the pane, so the views can keep their content
 * clear of it (Icons, List) or scroll out from behind it (Columns, Database).
 */
export default function SidePanel({
  title,
  subtitle,
  widthKey,
  defaultWidth = DEFAULT_WIDTH,
  minWidth = MIN_WIDTH,
  onClose,
  closeOnOutsideClick = false,
  children,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(() => storedWidth(widthKey, minWidth, defaultWidth));
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!closeOnOutsideClick) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || panelRef.current?.contains(target)) return;
      // Only presses in the app itself: dialogs and popovers sit outside it, in the body
      if (!document.getElementById("root")?.contains(target) || target.closest("[data-panel-toggle]")) return;
      // A field being edited in the panel commits as it loses focus, before the panel goes
      const active = document.activeElement;
      if (active instanceof HTMLElement && panelRef.current?.contains(active)) active.blur();
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [closeOnOutsideClick, onClose]);

  useLayoutEffect(() => {
    const pane = panelRef.current?.parentElement;
    if (!pane) return;
    pane.style.setProperty("--panel-width", `${Math.min(width, pane.clientWidth - 40)}px`);
    return () => {
      pane.style.removeProperty("--panel-width");
    };
  }, [width]);

  // Drag the left edge to resize; the panel can grow to nearly the full pane.
  // Mouse events, not pointer events: after a native menu closes WebKit can still
  // think the button is down and skip the next pointerdown, so the first click did nothing
  function startResize(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const maxWidth = (panelRef.current?.parentElement?.clientWidth ?? window.innerWidth) - 40;
    let latest = startWidth;
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(maxWidth, Math.max(minWidth, startWidth + startX - ev.clientX));
      setWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      try {
        localStorage.setItem(widthKey, String(latest));
      } catch {
        // ignore
      }
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      ref={panelRef}
      style={{ width, maxWidth: "calc(100% - 40px)" }}
      className={`absolute right-0 top-0 h-full flex flex-col bg-neutral-900 border-l border-neutral-700/60 shadow-2xl z-50 transition-transform duration-300 ${
        visible ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div
        onMouseDown={startResize}
        className="absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize z-10"
        aria-hidden
      />

      {/* Header */}
      {/* Header: one way out, Done in the footer */}
      <div className="px-5 py-4 border-b border-neutral-700/60 shrink-0 min-w-0">
        <h2 className="text-sm font-medium text-neutral-100">{title}</h2>
        {subtitle && <p className="text-xs text-neutral-500 mt-0.5 truncate">{subtitle}</p>}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-neutral-700/60 shrink-0 flex items-center justify-end">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded border border-neutral-700 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
