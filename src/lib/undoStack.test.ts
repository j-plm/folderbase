import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, record, takeRedo, takeUndo, type UndoEntry } from "./undoStack";

const entry = (label: string): UndoEntry => ({ label, undo: () => {}, redo: () => {} });

describe("undo history", () => {
  it("undoes the latest change first and can redo it", () => {
    let h = record(record(EMPTY_HISTORY, entry("a")), entry("b"));
    const u = takeUndo(h)!;
    expect(u.entry.label).toBe("b");
    h = u.history;
    const r = takeRedo(h)!;
    expect(r.entry.label).toBe("b");
    expect(r.history.past.map((e) => e.label)).toEqual(["a", "b"]);
  });

  it("a new change clears what could be redone", () => {
    let h = record(EMPTY_HISTORY, entry("a"));
    h = takeUndo(h)!.history;
    h = record(h, entry("c"));
    expect(takeRedo(h)).toBeNull();
  });

  it("keeps only the most recent changes", () => {
    let h = EMPTY_HISTORY;
    for (const l of ["a", "b", "c"]) h = record(h, entry(l), 2);
    expect(h.past.map((e) => e.label)).toEqual(["b", "c"]);
  });

  it("nothing to undo or redo returns null", () => {
    expect(takeUndo(EMPTY_HISTORY)).toBeNull();
    expect(takeRedo(EMPTY_HISTORY)).toBeNull();
  });
});
