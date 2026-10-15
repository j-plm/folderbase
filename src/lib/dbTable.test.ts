import { describe, expect, it } from "vitest";
import { applyFilters, cycleSort, fitRule, matchesRule, multiSort, type ColumnKind, type FilterRule } from "./dbTable";

const rule = (op: FilterRule["op"], value = "", column = "c"): FilterRule => ({ id: "r", column, op, value });

describe("matchesRule", () => {
  it("text conditions ignore case", () => {
    expect(matchesRule("Rig-A", "text", rule("contains", "rig"))).toBe(true);
    expect(matchesRule("Rig-A", "text", rule("is", "rig-a"))).toBe(true);
    expect(matchesRule("Rig-A", "text", rule("not_contains", "rig"))).toBe(false);
  });
  it("number conditions compare numerically, reading numeric text", () => {
    expect(matchesRule(10, "number", rule("gt", "9"))).toBe(true);
    expect(matchesRule("1,200", "number", rule("gte", "1200"))).toBe(true);
    expect(matchesRule(null, "number", rule("lt", "5"))).toBe(false);
  });
  it("date conditions compare by day, including EXIF dates", () => {
    expect(matchesRule("2024:03:01 10:00:00", "date", rule("is", "2024-03-01"))).toBe(true);
    expect(matchesRule("2024-03-01", "date", rule("before", "2024-04-01"))).toBe(true);
    expect(matchesRule("2024-03-01", "date", rule("after", "2024-04-01"))).toBe(false);
  });
  it("list conditions look at every value", () => {
    expect(matchesRule(["Apollo", "Hermes"], "list", rule("has", "hermes"))).toBe(true);
    expect(matchesRule("Apollo", "list", rule("has_not", "Apollo"))).toBe(false);
  });
  it("empty conditions treat empty lists and strings as empty", () => {
    expect(matchesRule([], "list", rule("empty"))).toBe(true);
    expect(matchesRule("", "text", rule("not_empty"))).toBe(false);
  });
  it("a rule without a value yet matches everything", () => {
    expect(matchesRule("x", "text", rule("is", ""))).toBe(true);
  });
});

describe("applyFilters", () => {
  const rows = [{ a: "x", n: 1 }, { a: "y", n: 2 }, { a: "x", n: 3 }];
  const get = (r: (typeof rows)[number], c: string) => r[c as "a" | "n"];
  const kind = (c: string): ColumnKind => (c === "n" ? "number" : "text");
  const rules = [rule("is", "x", "a"), rule("gt", "1", "n")];

  it("all requires every rule, any requires one", () => {
    expect(applyFilters(rows, rules, "all", get, kind)).toEqual([{ a: "x", n: 3 }]);
    expect(applyFilters(rows, rules, "any", get, kind)).toHaveLength(3);
  });
  it("no rules keeps every row", () => {
    expect(applyFilters(rows, [], "all", get, kind)).toBe(rows);
  });
});

describe("multiSort", () => {
  it("sorts by each key in turn, keeping ties stable", () => {
    const rows = [
      { id: 1, g: "b", n: 2 },
      { id: 2, g: "a", n: 2 },
      { id: 3, g: "a", n: 1 },
      { id: 4, g: "a", n: 1 },
    ];
    const sorted = multiSort(rows, [{ key: "g", direction: "asc" }, { key: "n", direction: "desc" }], (r, k) => r[k as "g" | "n"]);
    expect(sorted.map((r) => r.id)).toEqual([2, 3, 4, 1]);
  });
});

describe("fitRule", () => {
  it("swaps a condition the new column kind doesn't offer", () => {
    expect(fitRule(rule("contains", "x"), "number").op).toBe("eq");
    expect(fitRule(rule("empty"), "number").op).toBe("empty");
  });
});

describe("cycleSort", () => {
  it("goes ascending, descending, then unsorted", () => {
    const asc = cycleSort([], "a");
    expect(asc).toEqual([{ key: "a", direction: "asc" }]);
    const desc = cycleSort(asc, "a");
    expect(desc).toEqual([{ key: "a", direction: "desc" }]);
    expect(cycleSort(desc, "a")).toEqual([]);
  });
  it("a different column, or a multi-level sort, starts ascending", () => {
    expect(cycleSort([{ key: "a", direction: "desc" }], "b")).toEqual([{ key: "b", direction: "asc" }]);
    expect(cycleSort([{ key: "a", direction: "asc" }, { key: "b", direction: "asc" }], "a")).toEqual([{ key: "a", direction: "asc" }]);
  });
});
