// Finder-style multi-selection over an ordered list of item ids. Pure helpers;
// React wiring in useSelection.

export interface SelectionState {
  selected: string[];
  /** Fixed end of shift-click ranges: the last item clicked without Shift. */
  anchor: string | null;
  /** Selection when the anchor was set; a shift-range is added to this. */
  base: string[];
}

export const EMPTY_SELECTION: SelectionState = { selected: [], anchor: null, base: [] };

/** Longest gap between the clicks of a double-click (macOS default). */
export const DOUBLE_CLICK_MS = 500;

/** A selection of just `id`. */
export function singleSelection(id: string): SelectionState {
  return { selected: [id], anchor: id, base: [id] };
}

export interface ClickModifiers {
  /** Cmd on macOS, Ctrl elsewhere: toggle one item. */
  toggle: boolean;
  /** Shift: select the range from the anchor. */
  range: boolean;
}

function rangeIds(order: string[], a: string, b: string): string[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i === -1 || j === -1) return [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Ids in either list, in display order. */
function union(order: string[], a: string[], b: string[]): string[] {
  const set = new Set([...a, ...b]);
  return order.filter((id) => set.has(id));
}

/** Selection after clicking `id` with the given modifiers. */
export function clickSelect(
  state: SelectionState,
  order: string[],
  id: string,
  mods: ClickModifiers
): SelectionState {
  if (mods.range && state.anchor) {
    return { ...state, selected: union(order, state.base, rangeIds(order, state.anchor, id)) };
  }
  if (mods.toggle) {
    const selected = state.selected.includes(id)
      ? state.selected.filter((s) => s !== id)
      : [...state.selected, id];
    return { selected, anchor: id, base: selected };
  }
  return { selected: [id], anchor: id, base: [id] };
}

/**
 * Arrow-key movement in a list. Without Shift the selection collapses onto the
 * next item past the last one clicked or moved to; with Shift it extends the
 * range from the anchor.
 */
export function moveSelection(
  state: SelectionState,
  order: string[],
  delta: number,
  extend: boolean,
  /** The item the keyboard is on (the moving end of a shift-range). */
  cursor: string | null
): { state: SelectionState; cursor: string } | null {
  if (order.length === 0) return null;
  const from = cursor ? order.indexOf(cursor) : -1;
  const next =
    from === -1
      ? order[delta > 0 ? 0 : order.length - 1]
      : order[Math.max(0, Math.min(order.length - 1, from + delta))];
  if (extend && state.anchor) {
    return { state: clickSelect(state, order, next, { toggle: false, range: true }), cursor: next };
  }
  return { state: { selected: [next], anchor: next, base: [next] }, cursor: next };
}

export function selectAll(order: string[]): SelectionState {
  return { selected: [...order], anchor: order[0] ?? null, base: [...order] };
}

/**
 * Items a double-click on `id` opens: the whole selection when `id` is part of
 * it (Finder opens every selected item), otherwise just `id`.
 */
export function openTargets(state: SelectionState, order: string[], id: string): string[] {
  if (!state.selected.includes(id)) return [id];
  return order.filter((o) => state.selected.includes(o));
}
