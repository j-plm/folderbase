import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import { visibleItemCount } from "../../lib/overflow";
import { SymbolIcon } from "../../lib/fileIcons";

export interface OverflowItem {
  id: string;
  node: ReactNode;
  /** What this item becomes in the » menu once it no longer fits. */
  menu: MenuEntry[];
}

const GAP = 8;
const OVERFLOW_BUTTON_WIDTH = 28;

/**
 * Finder-style toolbar group: items that don't fit the available width move,
 * from the end, into a » button that opens a native menu.
 */
export default function OverflowBar({
  items,
  dragRegion = false,
}: {
  items: OverflowItem[];
  /** Empty space in the bar drags the window (title bar use). */
  dragRegion?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(Infinity);
  const [widths, setWidths] = useState<number[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setAvailable(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Natural widths come from an invisible copy, so they don't depend on what's
  // currently visible. Re-read after every render: labels can change.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- no deps by design; setWidths is guarded
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const next = Array.from(el.children).map((c) => (c as HTMLElement).offsetWidth);
    if (next.length !== widths.length || next.some((w, i) => w !== widths[i])) {
      setWidths(next);
    }
  });

  const naturalWidth = widths.reduce((sum, w, i) => sum + w + (i > 0 ? GAP : 0), 0);
  const count = widths.length === items.length
    ? visibleItemCount(widths, GAP, available, OVERFLOW_BUTTON_WIDTH)
    : items.length;
  const visible = items.slice(0, count);
  const overflowed = items.slice(count);

  function openOverflowMenu() {
    showContextMenu(
      overflowed.flatMap((item, i) =>
        i > 0 ? [{ type: "separator" } as MenuEntry, ...item.menu] : item.menu
      )
    );
  }

  return (
    <div
      ref={containerRef}
      data-tauri-drag-region={dragRegion || undefined}
      className="relative flex items-center justify-end min-w-0 overflow-hidden"
      // Basis = everything shown; may shrink down to just the » button.
      style={{ flex: `0 100 ${naturalWidth}px`, minWidth: OVERFLOW_BUTTON_WIDTH, gap: GAP }}
    >
      {visible.map((item) => (
        <div key={item.id} className="shrink-0">
          {item.node}
        </div>
      ))}
      {overflowed.length > 0 && (
        <button
          onClick={openOverflowMenu}
          title="More"
          className="shrink-0 flex items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-700/60"
          style={{ width: OVERFLOW_BUTTON_WIDTH, height: 24 }}
        >
          <SymbolIcon
            name="chevron.forward.2"
            size={14}
            fallback={
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 4l4 4-4 4M8.5 4l4 4-4 4" />
              </svg>
            }
          />
        </button>
      )}

      {/* Invisible measuring copy (visibility:hidden also keeps it out of tab order) */}
      <div
        ref={measureRef}
        aria-hidden
        className="absolute left-0 top-0 flex w-max invisible pointer-events-none"
        style={{ gap: GAP }}
      >
        {items.map((item) => (
          <div key={item.id} className="shrink-0">
            {item.node}
          </div>
        ))}
      </div>
    </div>
  );
}
