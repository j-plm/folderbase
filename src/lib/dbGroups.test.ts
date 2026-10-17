import { describe, it, expect } from "vitest";
import { flattenGroups, groupRows, levelState, setLevelCollapsed, toggleCollapsed, type GroupKey } from "./dbGroups";

interface Row {
  id: string;
  client?: string;
  year?: number;
}

const rows: Row[] = [
  { id: "a", client: "Globex", year: 2024 },
  { id: "b", client: "Acme", year: 2025 },
  { id: "c", year: 2024 },
  { id: "d", client: "Acme", year: 2024 },
  { id: "e", client: "Globex", year: 2024 },
];

const keyOf = (row: Row, column: string): GroupKey | null => {
  const v = row[column as keyof Row];
  return v == null ? null : { label: String(v), rank: v };
};
const empty = (column: string) => `No ${column}`;

describe("groupRows", () => {
  it("orders groups by rank, keeps row order inside each, and puts empty last", () => {
    const groups = groupRows(rows, [{ key: "client", direction: "asc" }], keyOf, empty);
    expect(groups.map((g) => g.label)).toEqual(["Acme", "Globex", "No client"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["b", "d"]);
    expect(groups[1].rows.map((r) => r.id)).toEqual(["a", "e"]);
  });

  it("descending reverses the groups but still puts empty last", () => {
    const groups = groupRows(rows, [{ key: "client", direction: "desc" }], keyOf, empty);
    expect(groups.map((g) => g.label)).toEqual(["Globex", "Acme", "No client"]);
  });

  it("nests one level inside another, with counts and path ids", () => {
    const groups = groupRows(
      rows,
      [
        { key: "client", direction: "asc" },
        { key: "year", direction: "desc" },
      ],
      keyOf,
      empty
    );
    const acme = groups[0];
    expect(acme.count).toBe(2);
    expect(acme.children.map((g) => [g.label, g.count, g.depth])).toEqual([
      ["2025", 1, 1],
      ["2024", 1, 1],
    ]);
    expect(acme.children[0].id).toBe("client=Acme\u001fyear=2025");
  });

  it("returns no groups without levels", () => {
    expect(groupRows(rows, [], keyOf, empty)).toEqual([]);
  });
});

describe("flattenGroups", () => {
  const groups = groupRows(
    rows,
    [
      { key: "client", direction: "asc" },
      { key: "year", direction: "asc" },
    ],
    keyOf,
    empty
  );

  it("lists headers then rows, striping from 0 in each group", () => {
    const { items, rows: visible } = flattenGroups(rows, groups, new Set());
    expect(items.map((i) => (i.type === "group" ? `#${i.group.label}` : i.row.id))).toEqual([
      "#Acme", "#2024", "d", "#2025", "b",
      "#Globex", "#2024", "a", "e",
      "#No client", "#2024", "c",
    ]);
    expect(visible.map((r) => r.id)).toEqual(["d", "b", "a", "e", "c"]);
    const e = items.find((i) => i.type === "row" && i.row.id === "e");
    expect(e).toMatchObject({ index: 3, stripe: 1 });
  });

  it("hides a collapsed group's subgroups and rows", () => {
    const { items, rows: visible } = flattenGroups(rows, groups, new Set(["client=Globex"]));
    expect(items.filter((i) => i.type === "group").map((i) => i.type === "group" && i.group.label)).toEqual([
      "Acme", "2024", "2025", "Globex", "No client", "2024",
    ]);
    expect(visible.map((r) => r.id)).toEqual(["d", "b", "c"]);
  });

  it("without groups is just the rows", () => {
    const { items, rows: visible } = flattenGroups(rows, null, new Set());
    expect(items).toHaveLength(5);
    expect(visible).toEqual(rows);
  });
});

describe("toggleCollapsed", () => {
  const groups = groupRows(rows, [{ key: "client", direction: "asc" }], keyOf, empty);

  it("flips one group", () => {
    const next = toggleCollapsed(new Set(), groups[1], groups);
    expect([...next]).toEqual(["client=Globex"]);
    expect([...toggleCollapsed(next, groups[1], groups)]).toEqual([]);
  });

  it("with all, makes every group at that depth follow", () => {
    const next = toggleCollapsed(new Set(), groups[0], groups, true);
    expect([...next].sort()).toEqual(["client=", "client=Acme", "client=Globex"]);
  });
});

describe("level collapse", () => {
  const groups = groupRows(
    rows,
    [
      { key: "client", direction: "asc" },
      { key: "year", direction: "asc" },
    ],
    keyOf,
    empty
  );

  it("collapses and expands one level, leaving the others alone", () => {
    const outer = new Set(["client=Acme"]);
    const next = setLevelCollapsed(outer, groups, 1, true);
    expect(next.has("client=Acme")).toBe(true);
    expect(levelState(next, groups, 1)).toBe("collapsed");
    expect(levelState(setLevelCollapsed(next, groups, 1, false), groups, 1)).toBe("expanded");
  });

  it("reports a level with some groups collapsed as mixed", () => {
    expect(levelState(new Set(["client=Acme"]), groups, 0)).toBe("mixed");
    expect(levelState(new Set(), groups, 0)).toBe("expanded");
  });
});
