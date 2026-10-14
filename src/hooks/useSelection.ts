import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { openPaths } from "../lib/commands";
import { hasPrimaryModifier, isOpenShortcut, isToggleSelect } from "../lib/platform";
import {
  DOUBLE_CLICK_MS,
  EMPTY_SELECTION,
  clickSelect,
  moveSelection,
  openTargets,
  selectAll,
  type SelectionState,
} from "../lib/selection";
import type { FileRecord } from "../types";

interface Options {
  /** Up/Down move the selection (lists); off for grids. */
  arrowKeys?: boolean;
  /** Called with a display index when the keyboard moves the selection, to scroll it into view. */
  onReveal?: (index: number) => void;
}

/**
 * Finder-style selection over `files` (in display order): click selects,
 * Cmd/Ctrl-click toggles, Shift-click selects a range, Cmd-A selects all.
 * Double-click or Cmd-O (Enter off macOS) opens the selection together.
 */
export function useSelection(files: FileRecord[], { arrowKeys = false, onReveal }: Options = {}) {
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION);
  const cursor = useRef<string | null>(null);
  const order = useMemo(() => files.map((f) => f.file_id), [files]);

  // Drop selected ids that are no longer shown (filtered out, location changed)
  useEffect(() => {
    const shown = new Set(order);
    setState((s) =>
      s.selected.every((id) => shown.has(id))
        ? s
        : { ...s, selected: s.selected.filter((id) => shown.has(id)), base: s.base.filter((id) => shown.has(id)) }
    );
  }, [order]);

  const selected = useMemo(() => new Set(state.selected), [state.selected]);

  function open(ids: string[]) {
    const byId = new Map(files.map((f) => [f.file_id, f.file_path]));
    const paths = ids.map((id) => byId.get(id)).filter((p): p is string => !!p);
    openPaths(paths).catch(() => {});
  }

  // A plain click on an item inside a multiple selection collapses it only once
  // a double-click can no longer follow, so double-clicking opens the whole selection.
  const pendingCollapse = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pendingCollapse.current), []);

  function onItemClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (e.detail > 1) return;
    window.clearTimeout(pendingCollapse.current);
    const mods = { toggle: isToggleSelect(e), range: e.shiftKey };
    cursor.current = id;
    if (!mods.toggle && !mods.range && state.selected.length > 1 && selected.has(id)) {
      pendingCollapse.current = window.setTimeout(
        () => setState((s) => clickSelect(s, order, id, mods)),
        DOUBLE_CLICK_MS
      );
      return;
    }
    setState((s) => clickSelect(s, order, id, mods));
  }

  function onItemDoubleClick(e: React.MouseEvent, id: string) {
    window.clearTimeout(pendingCollapse.current);
    if (e.shiftKey || isToggleSelect(e)) return;
    const targets = openTargets(state, order, id);
    if (!state.selected.includes(id)) setState(clickSelect(state, order, id, { toggle: false, range: false }));
    open(targets);
  }

  function clear() {
    setState(EMPTY_SELECTION);
    cursor.current = null;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (isOpenShortcut(e)) {
      e.preventDefault();
      if (state.selected.length > 0) open(order.filter((id) => selected.has(id)));
      return;
    }
    if (hasPrimaryModifier(e) && e.key === "a") {
      e.preventDefault();
      setState(selectAll(order));
      return;
    }
    if (arrowKeys && (e.key === "ArrowDown" || e.key === "ArrowUp") && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const moved = moveSelection(state, order, e.key === "ArrowDown" ? 1 : -1, e.shiftKey, cursor.current);
      if (!moved) return;
      setState(moved.state);
      cursor.current = moved.cursor;
      onReveal?.(order.indexOf(moved.cursor));
    }
  }

  return {
    isSelected: (id: string | undefined) => id != null && selected.has(id),
    onItemClick,
    onItemDoubleClick,
    /** Clicking empty space deselects everything. */
    clear,
    onKeyDown,
  };
}
