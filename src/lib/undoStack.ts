// Undo history for the database view: each entry knows how to reverse and
// reapply one change (a cell edit, a fill, a property rename…).

export interface UndoEntry {
  /** What the change was, e.g. "Paste" (for menus and messages). */
  label: string;
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
}

export interface UndoHistory {
  past: UndoEntry[];
  future: UndoEntry[];
}

export const EMPTY_HISTORY: UndoHistory = { past: [], future: [] };

/** How many changes can be undone. */
export const UNDO_LIMIT = 100;

/** A new change: it can be undone, and anything previously undone can no longer be redone. */
export function record(history: UndoHistory, entry: UndoEntry, limit = UNDO_LIMIT): UndoHistory {
  return { past: [...history.past, entry].slice(-limit), future: [] };
}

/** The change to undo, and the history once it's undone (it moves to the redo list). */
export function takeUndo(history: UndoHistory): { entry: UndoEntry; history: UndoHistory } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return { entry, history: { past: history.past.slice(0, -1), future: [...history.future, entry] } };
}

/** The change to redo, and the history once it's redone. */
export function takeRedo(history: UndoHistory): { entry: UndoEntry; history: UndoHistory } | null {
  const entry = history.future[history.future.length - 1];
  if (!entry) return null;
  return { entry, history: { past: [...history.past, entry], future: history.future.slice(0, -1) } };
}
