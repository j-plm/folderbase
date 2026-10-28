import { useRef, useState } from "react";
import type React from "react";

/** How far the pointer moves before a press becomes a drag, so clicks stay clicks. */
const DRAG_THRESHOLD = 4;

export interface DragReorder {
  /** The item being dragged and the gap (0..count) it would drop into, once a drag is under way. */
  drag: { from: number; gap: number } | null;
  /** Each item's element, by index, so the drop gap can be measured. */
  itemRef: (index: number) => (el: HTMLElement | null) => void;
  /** Press on an item: becomes a drag once the pointer moves. */
  onMouseDown: (e: React.MouseEvent, index: number) => void;
  /** Whether to draw the drop line above item `index` (or, with `after`, below the last one). */
  lineAt: (index: number, after?: boolean) => boolean;
}

/**
 * Drag to reorder a vertical list, as in Finder's sidebar: a line shows where
 * the item will land, and `onMove(from, gap)` reports a drop that changes the
 * order (`gap` counts items above the drop point, before the move).
 */
export function useDragReorder(count: number, onMove: (from: number, gap: number) => void): DragReorder {
  const [drag, setDrag] = useState<{ from: number; gap: number } | null>(null);
  const items = useRef(new Map<number, HTMLElement>());
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const itemRef = (index: number) => (el: HTMLElement | null) => {
    if (el) items.current.set(index, el);
    else items.current.delete(index);
  };

  /** The gap nearest `y`: how many items have their midpoint above it. */
  function gapAt(y: number): number {
    let gap = 0;
    for (let i = 0; i < count; i++) {
      const r = items.current.get(i)?.getBoundingClientRect();
      if (r && y > r.top + r.height / 2) gap = i + 1;
    }
    return gap;
  }

  function onMouseDown(e: React.MouseEvent, from: number) {
    if (e.button !== 0 || count < 2) return;
    const startY = e.clientY;
    let current: { from: number; gap: number } | null = null;
    function onMove(ev: MouseEvent) {
      if (!current && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      const gap = gapAt(ev.clientY);
      if (current?.gap === gap) return;
      current = { from, gap };
      setDrag(current);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!current) return;
      setDrag(null);
      // The press ends on the item: its click would select it, so swallow that
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      const { gap } = current;
      if (gap !== from && gap !== from + 1) onMoveRef.current(from, gap);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // No line where dropping leaves the order as it is
  const moves = drag != null && drag.gap !== drag.from && drag.gap !== drag.from + 1;
  const lineAt = (index: number, after = false) =>
    moves && (after ? index === count - 1 && drag.gap === count : drag.gap === index);

  return { drag, itemRef, onMouseDown, lineAt };
}
