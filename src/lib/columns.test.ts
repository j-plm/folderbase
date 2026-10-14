import { describe, expect, it } from "vitest";
import { compareSortValues, contentFitWidth, dropIndexAt, fitColumnWidths, moveColumnId, orderColumns, resizeColumn, toggleSort, type ColumnDef } from "./columns";

const cols: ColumnDef[] = [
  { id: "name", label: "Name", weight: 3, minWidth: 100 },
  { id: "kind", label: "Kind", weight: 1, minWidth: 50 },
];

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe("fitColumnWidths", () => {
  it("shares the available width by weight and fills it exactly", () => {
    const w = fitColumnWidths(cols, 401);
    expect(w.name).toBe(300);
    expect(sum(w)).toBe(401);
  });

  it("keeps user-resized columns fixed and refits the rest", () => {
    const w = fitColumnWidths(cols, 400, { name: 150 });
    expect(w).toEqual({ name: 150, kind: 250 });
  });

  it("never fits a column below its minimum", () => {
    const w = fitColumnWidths(cols, 120);
    expect(w).toEqual({ name: 100, kind: 50 });
  });

  it("raises a resized width that is below the minimum", () => {
    expect(fitColumnWidths(cols, 400, { kind: 10 }).kind).toBe(50);
  });

  it("re-pins a column when redistributing pushes it under its minimum", () => {
    const three: ColumnDef[] = [
      { id: "a", label: "A", weight: 1, minWidth: 10 },
      { id: "b", label: "B", weight: 1, minWidth: 140 },
      { id: "c", label: "C", weight: 10, minWidth: 10 },
    ];
    const w = fitColumnWidths(three, 300);
    expect(w.b).toBe(140);
    expect(sum(w)).toBe(300);
  });
});

describe("toggleSort", () => {
  it("flips direction on the same column and resets on a new one", () => {
    expect(toggleSort({ key: "name", direction: "asc" }, "name").direction).toBe("desc");
    expect(toggleSort({ key: "name", direction: "desc" }, "name").direction).toBe("asc");
    expect(toggleSort({ key: "name", direction: "desc" }, "size")).toEqual({ key: "size", direction: "asc" });
  });
});

describe("compareSortValues", () => {
  it("sorts names naturally and numbers numerically", () => {
    expect(compareSortValues("file2", "file10", "asc")).toBeLessThan(0);
    expect(compareSortValues(9, 10, "desc")).toBeGreaterThan(0);
  });

  it("puts empty values last in both directions", () => {
    expect(compareSortValues(null, "a", "asc")).toBe(1);
    expect(compareSortValues(null, "a", "desc")).toBe(1);
    expect(compareSortValues("", null, "asc")).toBe(0);
  });
});

describe("resizeColumn", () => {
  it("changes only the dragged column and lets the table outgrow the window", () => {
    const fitted = fitColumnWidths(cols, 400);
    const fixed = resizeColumn(cols, fitted, "name", fitted.name + 200);
    expect(fixed.kind).toBe(fitted.kind);
    const after = fitColumnWidths(cols, 400, fixed);
    expect(after.kind).toBe(fitted.kind);
    expect(sum(after)).toBe(600);
  });

  it("clamps to the column minimum", () => {
    expect(resizeColumn(cols, { name: 300, kind: 100 }, "kind", 5).kind).toBe(50);
  });
});

describe("contentFitWidth", () => {
  it("fits the widest cell plus padding", () => {
    expect(contentFitWidth([40, 180.2, 90], 30, 50)).toBe(205);
  });

  it("never goes below the header label or the column minimum", () => {
    expect(contentFitWidth([10], 60, 50)).toBe(98);
    expect(contentFitWidth([], 0, 120)).toBe(120);
  });
});

describe("column reordering", () => {
  const ids = ["name", "ext", "path", "size"];

  it("moves a column right or left", () => {
    expect(moveColumnId(ids, "ext", 3)).toEqual(["name", "path", "ext", "size"]);
    expect(moveColumnId(ids, "ext", 4)).toEqual(["name", "path", "size", "ext"]);
    expect(moveColumnId(ids, "size", 1)).toEqual(["name", "size", "ext", "path"]);
  });

  it("is a no-op when dropped on itself", () => {
    expect(moveColumnId(ids, "path", 2)).toEqual(ids);
    expect(moveColumnId(ids, "path", 3)).toEqual(ids);
  });

  it("applies a saved order, appending columns it doesn't mention", () => {
    const defs = ids.map((id) => ({ id, label: id, weight: 1, minWidth: 10 }));
    expect(orderColumns(defs, ["name", "size", "ext"]).map((c) => c.id)).toEqual(["name", "size", "ext", "path"]);
  });

  it("finds the drop slot from column midpoints, respecting a minimum", () => {
    expect(dropIndexAt([100, 50, 50], 140, 1)).toBe(2);
    expect(dropIndexAt([100, 50, 50], 10, 1)).toBe(1);
    expect(dropIndexAt([100, 50, 50], 999, 1)).toBe(3);
  });
});
