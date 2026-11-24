import { useEffect, useSyncExternalStore } from "react";

// How many files the visible view has selected, out of how many it shows, for
// the toolbar's "3 of 1,204 selected". Each view keeps its own selection and
// reports it here; only one view is shown at a time.

export interface SelectionStatus {
  selected: number;
  total: number;
}

const NONE: SelectionStatus = { selected: 0, total: 0 };
let status = NONE;
const listeners = new Set<() => void>();

export function setSelectionStatus(next: SelectionStatus): void {
  if (next.selected === status.selected && next.total === status.total) return;
  status = next.selected === 0 && next.total === 0 ? NONE : next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSelectionStatus(): SelectionStatus {
  return useSyncExternalStore(subscribe, () => status);
}

/** Reports a view's selection while it's shown, and clears it when the view goes. */
export function useReportSelection(selected: number, total: number): void {
  useEffect(() => {
    setSelectionStatus({ selected, total });
  }, [selected, total]);
  useEffect(() => () => setSelectionStatus(NONE), []);
}

/** "3 of 1,204 selected", or null unless several files are selected. */
export function selectionLabel({ selected, total }: SelectionStatus): string | null {
  if (selected < 2) return null;
  return `${selected.toLocaleString()} of ${total.toLocaleString()} selected`;
}

// The selected files themselves (their paths, in display order), for Get Info
// (⌘I) and the Inspector, which follows them. Reported alongside the count.

let selectedPaths: string[] = [];
const pathListeners = new Set<(paths: string[]) => void>();

const samePaths = (a: string[], b: string[]) => a.length === b.length && a.every((p, i) => p === b[i]);

export function setSelectedPaths(paths: string[]): void {
  if (samePaths(paths, selectedPaths)) return;
  selectedPaths = paths;
  pathListeners.forEach((l) => l(paths));
}

export function getSelectedPaths(): string[] {
  return selectedPaths;
}

/** Calls `listener` with the selected paths each time they change; returns a function that stops it. */
export function onSelectedPaths(listener: (paths: string[]) => void): () => void {
  pathListeners.add(listener);
  return () => pathListeners.delete(listener);
}

const NO_PATHS: string[] = [];

/** Reports a view's selected files while it's shown, and clears them when the view goes. */
export function useReportSelectedPaths(paths: string[]): void {
  const key = paths.join("\n");
  useEffect(() => {
    setSelectedPaths(paths);
    // `key` stands for `paths`, so a new array with the same paths doesn't report again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => setSelectedPaths(NO_PATHS), []);
}
