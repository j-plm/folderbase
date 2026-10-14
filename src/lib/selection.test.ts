import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, clickSelect, moveSelection, openTargets, selectAll } from "./selection";

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
