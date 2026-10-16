import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, clickSelect, gridNeighbor, moveSelection, moveSelectionTo, openTargets, selectAll } from "./selection";

const order = ["a", "b", "c", "d", "e"];
const plain = { toggle: false, range: false };
const toggle = { toggle: true, range: false };
const range = { toggle: false, range: true };

describe("clickSelect", () => {
  it("a plain click selects only that item", () => {
    const s = clickSelect(selectAll(order), order, "c", plain);
    expect(s.selected).toEqual(["c"]);
  });

  it("toggle adds and removes single items", () => {
    let s = clickSelect(EMPTY_SELECTION, order, "a", plain);
    s = clickSelect(s, order, "c", toggle);
    expect(s.selected).toEqual(["a", "c"]);
    s = clickSelect(s, order, "a", toggle);
    expect(s.selected).toEqual(["c"]);
  });

  it("shift selects the range from the anchor, in either direction", () => {
    let s = clickSelect(EMPTY_SELECTION, order, "d", plain);
    s = clickSelect(s, order, "b", range);
    expect(s.selected).toEqual(["b", "c", "d"]);
  });

  it("a second shift-click replaces the range rather than growing it", () => {
    let s = clickSelect(EMPTY_SELECTION, order, "b", plain);
    s = clickSelect(s, order, "e", range);
    s = clickSelect(s, order, "c", range);
    expect(s.selected).toEqual(["b", "c"]);
  });

  it("shift adds its range to items toggled before the anchor", () => {
    let s = clickSelect(EMPTY_SELECTION, order, "a", plain);
    s = clickSelect(s, order, "c", toggle);
    s = clickSelect(s, order, "e", range);
    expect(s.selected).toEqual(["a", "c", "d", "e"]);
  });

  it("shift with no anchor behaves as a plain click", () => {
    expect(clickSelect(EMPTY_SELECTION, order, "b", range).selected).toEqual(["b"]);
  });
});

describe("moveSelection", () => {
  it("starts at the first item going down and the last going up", () => {
    expect(moveSelection(EMPTY_SELECTION, order, 1, false, null)?.cursor).toBe("a");
    expect(moveSelection(EMPTY_SELECTION, order, -1, false, null)?.cursor).toBe("e");
  });

  it("extends a range with shift and stops at the ends", () => {
    let s = clickSelect(EMPTY_SELECTION, order, "d", plain);
    let r = moveSelection(s, order, 1, true, "d")!;
    r = moveSelection(r.state, order, 1, true, r.cursor)!;
    expect(r.state.selected).toEqual(["d", "e"]);
    s = r.state;
    expect(moveSelection(s, order, -3, false, r.cursor)?.state.selected).toEqual(["b"]);
  });

  it("does nothing in an empty list", () => {
    expect(moveSelection(EMPTY_SELECTION, [], 1, false, null)).toBeNull();
  });
});

describe("openTargets", () => {
  it("opens the whole selection, in display order, when the item is in it", () => {
    let s = clickSelect(EMPTY_SELECTION, order, "d", plain);
    s = clickSelect(s, order, "b", toggle);
    expect(openTargets(s, order, "d")).toEqual(["b", "d"]);
  });

  it("opens just the item when it is outside the selection", () => {
    const s = clickSelect(EMPTY_SELECTION, order, "a", plain);
    expect(openTargets(s, order, "c")).toEqual(["c"]);
  });
});

describe("gridNeighbor", () => {
  // Group 1: a b c / d e      Group 2 (below a header): f g
  const items = [
    { id: "a", x: 50, y: 50 },
    { id: "b", x: 160, y: 50 },
    { id: "c", x: 270, y: 50 },
    { id: "d", x: 50, y: 180 },
    { id: "e", x: 160, y: 180 },
    { id: "f", x: 50, y: 360 },
    { id: "g", x: 160, y: 360 },
  ];

  it("left and right stay in the row, stopping at its ends", () => {
    expect(gridNeighbor(items, "b", "ArrowRight")).toBe("c");
    expect(gridNeighbor(items, "b", "ArrowLeft")).toBe("a");
    expect(gridNeighbor(items, "c", "ArrowRight")).toBeNull();
    expect(gridNeighbor(items, "d", "ArrowLeft")).toBeNull();
  });

  it("up and down go to the nearest row, closest column", () => {
    expect(gridNeighbor(items, "b", "ArrowDown")).toBe("e");
    expect(gridNeighbor(items, "e", "ArrowUp")).toBe("b");
    // c has nothing directly below: the nearest item in the next row
    expect(gridNeighbor(items, "c", "ArrowDown")).toBe("e");
  });

  it("crosses into the next group and stops at the edges", () => {
    expect(gridNeighbor(items, "e", "ArrowDown")).toBe("g");
    expect(gridNeighbor(items, "g", "ArrowDown")).toBeNull();
    expect(gridNeighbor(items, "a", "ArrowUp")).toBeNull();
  });
});

describe("moveSelectionTo", () => {
  const order = ["a", "b", "c", "d", "e"];
  it("selects the target, or with Shift the reading-order range from the anchor", () => {
    const one = moveSelectionTo(EMPTY_SELECTION, order, "b", false);
    expect(one.state.selected).toEqual(["b"]);
    const range = moveSelectionTo(one.state, order, "e", true);
    expect(range.state.selected).toEqual(["b", "c", "d", "e"]);
    expect(range.state.anchor).toBe("b");
  });
});
