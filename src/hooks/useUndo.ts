import { useCallback, useEffect, useRef } from "react";
import { EMPTY_HISTORY, record, takeRedo, takeUndo, type UndoEntry, type UndoHistory } from "../lib/undoStack";

/**
 * Undo and redo for a view. Changes and their reversals run one at a time, in
 * order, so an undo never overtakes the write it reverses. History is dropped
 * when `resetKey` changes (e.g. another location is shown).
 */
export function useUndo(
  resetKey: unknown,
  onError: (e: unknown) => void,
  /** Called whenever what can be undone or redone changes (e.g. to retitle Edit ▸ Undo). */
  onChange?: (history: UndoHistory) => void
) {
  const history = useRef<UndoHistory>(EMPTY_HISTORY);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const update = useCallback((next: UndoHistory) => {
    history.current = next;
    onChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    update(EMPTY_HISTORY);
  }, [resetKey, update]);

  /** Runs `task` after every change already queued. Don't call from inside an undo or redo. */
  const queue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const result = chain.current.then(task);
    chain.current = result.then(
      () => {},
      () => {}
    );
    return result;
  }, []);

  /** Records a change that has been made, so it can be undone. */
  const push = useCallback(
    (entry: UndoEntry) => {
      update(record(history.current, entry));
    },
    [update]
  );

  const step = useCallback(
    (direction: "undo" | "redo") => {
      queue(async () => {
        const taken = direction === "undo" ? takeUndo(history.current) : takeRedo(history.current);
        if (!taken) return;
        update(taken.history);
        try {
          await taken.entry[direction]();
        } catch (e) {
          onErrorRef.current(e);
        }
      });
    },
    [queue, update]
  );

  const undo = useCallback(() => step("undo"), [step]);
  const redo = useCallback(() => step("redo"), [step]);

  return { queue, push, undo, redo };
}
