import { describe, expect, it } from "vitest";
import {
  EMPTY_CELLS,
  cellKey,
  clickCell,
  copyGrid,
  fillWrites,
  isSolidRect,
  moveCell,
  parseTsv,
  pasteWrites,
  pruneCells,
  type CellSelection,
} from "./cellSelection";

const grid = { rows: ["r0", "r1", "r2", "r3", "r4"], cols: ["a", "b"] };
const plain = { toggle: false, range: false };
const keys = (sel: CellSelection) => [...sel.cells].sort();
const k = (row: string, col: string) => cellKey({ row, col });

describe("clickCell", () => {
  it("click selects one cell, Cmd-click toggles, Shift-click selects the rectangle", () => {
    let sel = clickCell(EMPTY_CELLS, { row: "r0", col: "a" }, plain, grid);
    expect(keys(sel)).toEqual([k("r0", "a")]);
    sel = clickCell(sel, { row: "r2", col: "b" }, { toggle: false, range: true }, grid);
    expect(sel.cells.size).toBe(6);
    sel = clickCell(sel, { row: "r1", col: "a" }, { toggle: true, range: false }, grid);
    expect(sel.cells.has(k("r1", "a"))).toBe(false);
    expect(sel.cells.size).toBe(5);
  });
});

describe("moveCell", () => {
  it("moves within the grid and extends with Shift", () => {
    let sel = clickCell(EMPTY_CELLS, { row: "r0", col: "a" }, plain, grid);
    sel = moveCell(sel, -1, 0, false, grid);
    expect(sel.active).toEqual({ row: "r0", col: "a" });
    sel = moveCell(sel, 2, 1, true, grid);
    expect(sel.cells.size).toBe(6);
    expect(sel.anchor).toEqual({ row: "r0", col: "a" });
  });
});

describe("isSolidRect", () => {
  it("accepts a filled rectangle and rejects a gappy selection", () => {
    let sel = clickCell(EMPTY_CELLS, { row: "r0", col: "a" }, plain, grid);
    sel = clickCell(sel, { row: "r1", col: "b" }, { toggle: false, range: true }, grid);
    expect(isSolidRect(sel, grid)).toEqual({ r0: 0, r1: 1, c0: 0, c1: 1 });
    sel = clickCell(sel, { row: "r0", col: "b" }, { toggle: true, range: false }, grid);
    expect(isSolidRect(sel, grid)).toBeNull();
  });
});

describe("fillWrites", () => {
  const values: Record<string, unknown> = { r1: "x", r2: "y" };
  const get = (row: string) => values[row];
  const rect = { r0: 1, r1: 2, c0: 0, c1: 0 };

  it("repeats the selected rows downward", () => {
    expect(fillWrites(rect, 4, grid, get)).toEqual([
      { row: "r3", col: "a", value: "x" },
      { row: "r4", col: "a", value: "y" },
    ]);
  });
  it("repeats upward ending on the first selected row", () => {
    expect(fillWrites(rect, 0, grid, get)).toEqual([{ row: "r0", col: "a", value: "y" }]);
  });
  it("writes nothing when dragged within the selection", () => {
    expect(fillWrites(rect, 2, grid, get)).toEqual([]);
  });
});

describe("copy and paste", () => {
  it("copies the bounding rectangle with gaps empty", () => {
    let sel = clickCell(EMPTY_CELLS, { row: "r0", col: "a" }, plain, grid);
    sel = clickCell(sel, { row: "r1", col: "b" }, { toggle: true, range: false }, grid);
    expect(copyGrid(sel, grid, (r, c) => `${r}${c}`)).toEqual([
      ["r0a", null],
      [null, "r1b"],
    ]);
  });
  it("a single value fills every selected cell", () => {
    let sel = clickCell(EMPTY_CELLS, { row: "r0", col: "a" }, plain, grid);
    sel = clickCell(sel, { row: "r3", col: "a" }, { toggle: true, range: false }, grid);
    expect(pasteWrites([["v"]], sel, grid)).toHaveLength(2);
  });
  it("a block lands from the top-left, clipped to the table", () => {
    const sel = clickCell(EMPTY_CELLS, { row: "r4", col: "b" }, plain, grid);
    expect(pasteWrites([["1", "2"], ["3", "4"]], sel, grid)).toEqual([{ row: "r4", col: "b", value: "1" }]);
  });
  it("parses spreadsheet clipboard text", () => {
    expect(parseTsv("a\tb\r\nc\td\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("pruneCells", () => {
  it("drops cells whose rows are no longer shown", () => {
    let sel = clickCell(EMPTY_CELLS, { row: "r0", col: "a" }, plain, grid);
    sel = clickCell(sel, { row: "r1", col: "a" }, { toggle: true, range: false }, grid);
    const pruned = pruneCells(sel, { rows: ["r0"], cols: ["a", "b"] });
    expect(keys(pruned)).toEqual([k("r0", "a")]);
    expect(pruned.active).toEqual({ row: "r0", col: "a" });
  });
});
