import { describe, expect, it } from "vitest";
import { carriedValues, filterValues, planViewDrop, type ValueSource } from "./sidebarDrop";
import type { FilterItem, FilterRule } from "./dbTable";
import type { FileRecord, ValueType } from "../types";

const file = (id: string, metadata: Record<string, unknown>): FileRecord => ({
  file_id: id,
  file_path: `/root/${id}.pdf`,
  relative_path: `${id}.pdf`,
  file_type: "application/pdf",
  timestamp: "2024-03-12T10:00:00Z",
  library: "docs",
  metadata,
  tags: [],
});

const TYPES: Record<string, ValueType> = { Client: "enum", Project: "array", Due: "date", Count: "number", Tags: "array" };
const src: ValueSource = {
  typeOf: (name) => TYPES[name] ?? "free_text",
  scopes: [],
  label: (column) => column.replace(/^prop:/, "").replace(/^type$/, "Kind"),
};

let n = 0;
const rule = (column: string, op: FilterRule["op"], value = ""): FilterRule => ({ id: String(n++), column, op, value });

describe("filterValues", () => {
  it("gives the value an is, = or has names", () => {
    const out = filterValues(
      [rule("prop:Client", "is", "Acme"), rule("prop:Project", "has", "Hermes"), rule("prop:Count", "eq", "3"), rule("prop:Due", "is", "2024-03-01")],
      "all",
      src
    );
    expect(out.values.map((v) => `${v.column}=${v.value}`)).toEqual(["prop:Client=Acme", "prop:Project=Hermes", "prop:Count=3", "prop:Due=2024-03-01"]);
    expect(out.unmet).toEqual([]);
  });

  it("lists filters that name no one value, and columns read from the file", () => {
    const out = filterValues(
      [rule("prop:Client", "contains", "Ac"), rule("prop:Client", "is_not", "Globex"), rule("type", "is", "PDF"), rule("prop:Due", "before", "2024-03-01"), rule("prop:Client", "empty")],
      "all",
      src
    );
    expect(out.values).toEqual([]);
    expect(out.unmet).toEqual(["Client contains Ac", "Client is not Globex", "Kind is PDF", "Due is before 2024-03-01", "Client is empty"]);
  });

  it("gives nothing for Or, unless only one filter is in it", () => {
    const group: FilterItem = { id: "g", match: "any", items: [rule("prop:Client", "is", "Acme"), rule("prop:Client", "is", "Globex")] };
    expect(filterValues([group], "all", src)).toEqual({ values: [], unmet: ["any of Client is Acme, Client is Globex"] });
    const one: FilterItem = { id: "h", match: "any", items: [rule("prop:Client", "is", "Acme"), rule("prop:Project", "has", "")] };
    expect(filterValues([one], "all", src).values).toEqual([{ column: "prop:Client", value: "Acme" }]);
  });

  it("keeps one value for a single-value property, and several for a Multi-select", () => {
    const out = filterValues(
      [rule("prop:Client", "is", "Acme"), rule("prop:Client", "is", "Globex"), rule("prop:Project", "has", "A"), rule("prop:Project", "has", "B")],
      "all",
      src
    );
    expect(out.values.map((v) => v.value)).toEqual(["Acme", "A", "B"]);
    expect(out.unmet).toEqual(["Client is Globex"]);
  });
});

describe("planViewDrop", () => {
  it("sets, adds and replaces, listing each with its counts", () => {
    const files = [file("1", {}), file("2", { Client: "Globex", Project: ["A"] }), file("3", { Client: "acme", Project: ["Hermes"] })];
    const plan = planViewDrop(files, [rule("prop:Client", "is", "Acme"), rule("prop:Project", "has", "Hermes")], "all", src);
    expect(plan.edits).toEqual([
      { file_id: "1", key: "Client", value: "Acme" },
      { file_id: "1", key: "Project", value: ["Hermes"] },
      { file_id: "2", key: "Client", value: "Acme" },
      { file_id: "2", key: "Project", value: ["A", "Hermes"] },
    ]);
    expect(plan.before).toContainEqual({ file_id: "2", key: "Client", value: "Globex" });
    expect(plan.files).toBe(2);
    expect(plan.lines).toEqual(["Client: Acme (1 set, 1 replaced)", "Project: Hermes (1 set, 1 added)"]);
    expect(plan.hidden).toBe(0);
  });

  it("counts files the filters that give no value still leave out", () => {
    const files = [file("1", { Count: 1 }), file("2", { Count: 9 })];
    const plan = planViewDrop(files, [rule("prop:Client", "is", "Acme"), rule("prop:Count", "gt", "5")], "all", src);
    expect(plan.files).toBe(2);
    expect(plan.unmet).toEqual(["Count > 5"]);
    expect(plan.hidden).toBe(1);
  });

  it("changes nothing for files already in the view", () => {
    const plan = planViewDrop([file("1", { Count: 3 })], [rule("prop:Count", "eq", "3")], "all", src);
    expect(plan.edits).toEqual([]);
    expect(plan.lines).toEqual(["Count: 3 (already set)"]);
  });
});

describe("carriedValues", () => {
  it("lists custom values by property, leaving out values read from the file", () => {
    const files = [
      file("1", { Client: "Acme", Tags: ["Rent", "Bills"], camera_make: "Canon" }),
      file("2", { Client: "Globex", Tags: ["Rent"], Notes: "" }),
    ];
    expect(carriedValues(files, src.typeOf)).toEqual(["Client: Acme, Globex", "Tags: Rent, Bills"]);
  });
});
