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
