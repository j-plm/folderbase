// Edit ▸ Undo / Redo. When a text field has focus, they undo typing in it;
// otherwise they go to whichever view has registered its change history.

export type EditAction = "undo" | "redo";

export interface UndoTarget {
  undo: () => void;
  redo: () => void;
}

let target: UndoTarget | null = null;

/** Makes `t` receive Undo / Redo; returns a function that unregisters it. */
export function setUndoTarget(t: UndoTarget): () => void {
  target = t;
  return () => {
    if (target === t) target = null;
  };
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", ""]);

/**
 * Whether `el` is a field the user types into, whose own undo applies.
 * Elements marked `data-edit-sink` (offscreen fields that only carry keyboard
 * focus and the clipboard) don't count.
 */
export function isTextField(el: Element | null): boolean {
  if (!el || (el as HTMLElement).dataset?.editSink != null) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return (el as HTMLElement).isContentEditable === true;
}

/** Performs Undo or Redo for whatever has focus. */
export function performEdit(action: EditAction): void {
  if (isTextField(document.activeElement)) {
    document.execCommand(action);
    return;
  }
  target?.[action]();
}
