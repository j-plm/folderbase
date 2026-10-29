import { describe, it, expect } from "vitest";
import type { FilterGroup, FilterItem, FilterRule } from "./dbTable";
import {
  activeFilters,
  canMoveInto,
  duplicateItem,
  filterRules,
  mapRules,
  moveItem,
  parseFilterItems,
  removeItem,
  serializeFilterItems,
  setGroupMatch,
  ungroup,
  wrapInGroup,
} from "./filterTree";

const r = (id: string, value = "x"): FilterRule => ({ id, column: "name", op: "contains", value });
const g = (id: string, items: FilterItem[], match: "all" | "any" = "any"): FilterGroup => ({ id, match, items });

/** The list's shape by ids: a group as [id, ...its items]. */
const shape = (items: FilterItem[]): unknown[] => items.map((x) => ("items" in x ? [x.id, ...shape(x.items)] : x.id));

// a, (b, c), d
const list = (): FilterItem[] => [r("a"), g("G", [r("b"), r("c")]), r("d")];

describe("filterRules and mapRules", () => {
  it("opens groups up, in order", () => {
    expect(filterRules(list()).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("drops groups left empty", () => {
    const out = mapRules(list(), (x) => (x.id === "b" || x.id === "c" ? null : x));
    expect(shape(out)).toEqual(["a", "d"]);
  });
  it("keeps only filters that narrow anything", () => {
    expect(shape(activeFilters([r("a", ""), g("G", [r("b", " ")]), r("c")]))).toEqual(["c"]);
  });
});

describe("moveItem", () => {
  it("moves into a group, and out of one", () => {
    expect(shape(moveItem(list(), "a", "G", 1))).toEqual([["G", "b", "a", "c"], "d"]);
    expect(shape(moveItem(list(), "c", null, 0))).toEqual(["c", "a", ["G", "b"], "d"]);
  });
  it("counts places before the item was taken out", () => {
    expect(shape(moveItem(list(), "a", null, 3))).toEqual([["G", "b", "c"], "d", "a"]);
    expect(moveItem(list(), "a", null, 1)).toEqual(list());
  });
  it("removes a group its last item leaves", () => {
    const one: FilterItem[] = [r("a"), g("G", [r("b")])];
    expect(shape(moveItem(one, "b", null, 0))).toEqual(["b", "a"]);
  });
  it("won't put a group inside itself, or groups deeper than allowed", () => {
    const nested: FilterItem[] = [g("G", [r("b"), g("H", [r("c")])]), g("K", [r("d")])];
    expect(canMoveInto(nested, "G", "H")).toBe(false);
    expect(moveItem(nested, "G", "H", 0)).toBe(nested);
    // G holds a group: inside K it would be three deep
    expect(canMoveInto(nested, "G", "K")).toBe(false);
    expect(canMoveInto(nested, "K", "G")).toBe(true);
    expect(canMoveInto(nested, "K", "H")).toBe(false);
    expect(canMoveInto(nested, "d", "H")).toBe(true);
  });
});

describe("grouping", () => {
  it("puts an item in a group joined the other way to its list", () => {
    const out = wrapInGroup(list(), "a", "all");
    expect(shape(out)).toEqual([[expect.any(String), "a"], ["G", "b", "c"], "d"]);
    expect((out[0] as FilterGroup).match).toBe("any");
    const inner = wrapInGroup(list(), "b", "all");
    expect((((inner[1] as FilterGroup).items[0]) as FilterGroup).match).toBe("all");
  });
  it("won't group deeper than allowed", () => {
    const deep: FilterItem[] = [g("G", [g("H", [r("c")])])];
    expect(wrapInGroup(deep, "c", "all")).toBe(deep);
  });
  it("ungroups in place", () => {
    expect(shape(ungroup(list(), "G"))).toEqual(["a", "b", "c", "d"]);
  });
  it("sets a group's And/Or", () => {
    expect((setGroupMatch(list(), "G", "all")[1] as FilterGroup).match).toBe("all");
  });
  it("duplicates with new ids, removes with empty groups", () => {
    const out = duplicateItem(list(), "G");
    expect(out).toHaveLength(4);
    const copy = out[2] as FilterGroup;
    expect(copy.id).not.toBe("G");
    expect(copy.items.map((x) => x.id)).not.toContain("b");
    expect(shape(removeItem(removeItem(list(), "b"), "c"))).toEqual(["a", "d"]);
  });
});

describe("stored form", () => {
  it("round-trips groups and skips what it can't read", () => {
    const items: FilterItem[] = [r("a"), g("G", [r("b"), g("H", [{ ...r("c"), item: "last" }], "all")])];
    expect(parseFilterItems(JSON.parse(JSON.stringify(serializeFilterItems(items))))).toEqual(items);
    expect(parseFilterItems([1, { column: "name" }, { id: "E", items: [] }, r("a")])).toEqual([r("a")]);
    expect(parseFilterItems("nope")).toBeNull();
  });
});
