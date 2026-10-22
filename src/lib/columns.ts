import type React from "react";
// Finder-style table columns: fit to the available width, user-resizable,
// sortable by header click. Pure helpers here; React wiring in useColumnLayout.

export interface ColumnDef {
  id: string;
  label: string;
  /** Share of the free width this column takes when fitting. */
  weight: number;
  /** Narrowest the column can be fitted or dragged to, in px. */
  minWidth: number;
  align?: "left" | "right";
  sortable?: boolean;
  /** False keeps the column in place (e.g. Name stays first). */
  reorderable?: boolean;
  /** False stops the column being dragged to zero width to hide it (e.g. Name). */
  hideable?: boolean;
  /** False hides the divider (e.g. the database view's "+" column). */
  resizable?: boolean;
}

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  direction: SortDirection;
}

/**
 * Widths for each column. Columns in `fixed` (resized by the user) keep that
 * width; the rest share the remaining space by weight, never below minWidth.
 * If everything can't fit, flexible columns sit at minWidth and the table
 * scrolls horizontally.
 */
export function fitColumnWidths(
  columns: ColumnDef[],
  available: number,
  fixed: Record<string, number> = {}
): Record<string, number> {
  const widths: Record<string, number> = {};
  let remaining = available;
  let flexible: ColumnDef[] = [];

  for (const col of columns) {
    const w = fixed[col.id];
    if (w != null) {
      widths[col.id] = Math.max(col.minWidth, Math.round(w));
      remaining -= widths[col.id];
    } else {
      flexible.push(col);
    }
  }

  // Pin any column whose weighted share falls below its minimum, then
  // redistribute among the rest until every share is valid.
  for (;;) {
    const totalWeight = flexible.reduce((sum, c) => sum + c.weight, 0);
    const tooNarrow = flexible.filter(
      (c) => totalWeight === 0 || (Math.max(remaining, 0) * c.weight) / totalWeight < c.minWidth
    );
    if (tooNarrow.length === 0) break;
    for (const col of tooNarrow) {
      widths[col.id] = col.minWidth;
      remaining -= col.minWidth;
    }
    flexible = flexible.filter((c) => !tooNarrow.includes(c));
  }

  const totalWeight = flexible.reduce((sum, c) => sum + c.weight, 0);
  let assigned = 0;
  flexible.forEach((col, i) => {
    const isLast = i === flexible.length - 1;
    const w = isLast ? remaining - assigned : Math.floor((remaining * col.weight) / totalWeight);
    widths[col.id] = w;
    assigned += w;
  });

  return widths;
}

/**
 * Fixed widths after the user drags `columnId` to `width`. Every visible column
 * is pinned at its current width first, so resizing one column never changes
 * any other; the table grows (and scrolls) instead.
 */
export function resizeColumn(
  columns: ColumnDef[],
  current: Record<string, number>,
  columnId: string,
  width: number
): Record<string, number> {
  const fixed: Record<string, number> = {};
  for (const col of columns) {
    fixed[col.id] = current[col.id] ?? col.minWidth;
  }
  const column = columns.find((c) => c.id === columnId);
  if (column) fixed[columnId] = Math.max(column.minWidth, Math.round(width));
  return fixed;
}

/** Horizontal padding of a cell (px-3 on both sides). */
export const CELL_PADDING = 24;

/**
 * Dragging a hideable column below its minimum: it follows the pointer down to
 * this width and stops there ("held"). Held there it then flashes ("armed")
 * and closes, unless released before the flash starts.
 */
export const COLLAPSE_DETENT = 24;
/** Time held at the detent before the column flashes. */
export const COLLAPSE_HOLD_MS = 225;
/** Length of the flash; the column closes when it ends. Matches `column-arm` in index.css. */
export const COLLAPSE_ARM_MS = 260;
/** Duration of the closing animation. */
export const COLLAPSE_ANIMATION_MS = 135;

/**
 * "held": stopped at the detent. "armed": flashing, about to close.
 * "closing": animating to zero width.
 */
export type ColumnPhase = "held" | "armed" | "closing";

/**
 * Style for a cell `width` wide. Below the normal padding the padding shrinks
 * with it so the cell can reach 0; a held column dims and a closing one
 * animates its width and fades out.
 */
export function cellBoxStyle(width: number | undefined, phase?: ColumnPhase): React.CSSProperties {
  const style: React.CSSProperties = { width };
  if (width != null && width < CELL_PADDING) {
    Object.assign(style, { paddingLeft: width / 2, paddingRight: width / 2, overflow: "hidden" });
  }
  if (phase === "held") {
    style.opacity = 0.4;
    style.transition = `opacity 120ms ${EASE_OUT}`;
  } else if (phase === "armed") {
    style.opacity = 0.3;
    style.animation = `column-arm ${COLLAPSE_ARM_MS}ms ease-in-out both`;
  } else if (phase === "closing") {
    // Shrinks and fades away, as a Dock item does when removed, carrying on
    // from where the warning flash ends
    style.opacity = 0;
    style.animation = `column-close ${COLLAPSE_ANIMATION_MS}ms ${EASE_OUT} both`;
    style.transition = (["width", "padding"] as const)
      .map((p) => `${p} ${COLLAPSE_ANIMATION_MS}ms ${EASE_OUT}`)
      .join(", ");
  }
  return style;
}

/** Core Animation's default ease-out timing curve. */
const EASE_OUT = "cubic-bezier(0, 0, 0.58, 1)";
/** Header padding plus room for the sort chevron. */
const HEADER_CHROME = CELL_PADDING + 14;

/**
 * Width that shows every cell's content and the header label in full
 * (Finder's double-click-the-divider behaviour).
 */
export function contentFitWidth(cellWidths: number[], headerWidth: number, minWidth: number): number {
  const widest = Math.max(headerWidth + HEADER_CHROME, ...cellWidths.map((w) => w + CELL_PADDING));
  return Math.max(minWidth, Math.ceil(widest));
}

/** `columns` in the saved `order`; columns missing from it keep their default relative position at the end. */
export function orderColumns(columns: ColumnDef[], order: string[]): ColumnDef[] {
  const rank = (c: ColumnDef) => {
    const i = order.indexOf(c.id);
    return i === -1 ? order.length + columns.indexOf(c) : i;
  };
  return [...columns].sort((a, b) => rank(a) - rank(b));
}

/** Moves `id` so it lands before the item currently at `targetIndex` (0..ids.length). */
export function moveColumnId(ids: string[], id: string, targetIndex: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const without = ids.filter((x) => x !== id);
  const insertAt = Math.max(0, Math.min(without.length, from < targetIndex ? targetIndex - 1 : targetIndex));
  return [...without.slice(0, insertAt), id, ...without.slice(insertAt)];
}

/**
 * Insertion index for a header dragged to `x` (px from the table's left edge):
 * the number of columns whose midpoint lies left of x, never before `minIndex`.
 */
export function dropIndexAt(widths: number[], x: number, minIndex: number): number {
  let left = 0;
  let index = 0;
  for (const w of widths) {
    if (x > left + w / 2) index++;
    left += w;
  }
  return Math.max(minIndex, index);
}

/** Clicking a header: same column flips direction, a new column sorts ascending. */
export function toggleSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

// One collator for every comparison: localeCompare with options builds a new
// one per call, which makes sorting tens of thousands of files take seconds.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Compares two sort values; null / undefined / "" always sort last. */
export function compareSortValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: SortDirection
): number {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const cmp =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : collator.compare(String(a), String(b));
  return direction === "asc" ? cmp : -cmp;
}
