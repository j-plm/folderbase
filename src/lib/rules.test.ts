import { describe, it, expect } from "vitest";
import { definitionFromFilter, parseDefinition, planRule, planRules, ruleSlots, writeKeys, type RuleDefinition, type RuleEnv } from "./rules";
import { PROP_PREFIX, nativeValue, NATIVE_KINDS, KIND_BY_TYPE, metaValue } from "./fileColumns";
import type { FileRecord, ValueType } from "../types";

const file = (id: string, path: string, metadata: Record<string, unknown> = {}): FileRecord =>
  ({ file_id: id, file_path: `/docs/${path}`, relative_path: path, metadata, tags: [] }) as unknown as FileRecord;

const types: Record<string, ValueType> = { Person: "enum", Date: "date", Tags: "array", Code: "free_text", Amount: "number" };
const env = (written: Set<string> = new Set()): RuleEnv => ({
  valueOf: (f, c) => (c.startsWith(PROP_PREFIX) ? metaValue(f, c.slice(PROP_PREFIX.length)) : nativeValue(f, c)),
  kindOf: (c) => (c.startsWith(PROP_PREFIX) ? KIND_BY_TYPE[types[c.slice(PROP_PREFIX.length)] ?? "free_text"] : NATIVE_KINDS[c] ?? "text"),
  typeOf: (p) => types[p] ?? null,
  configOf: () => ({}),
  written,
});

const statements: RuleDefinition = {
  match: "all",
  conditions: [{ id: "c1", column: "name", op: "matches", value: "{Date:6}_{Person}" }],
  actions: [
    { id: "a1", property: "Person", mode: "slot", value: "Person" },
    { id: "a2", property: "Date", mode: "slot", value: "Date", format: "YYMMDD" },
  ],
};

const files = [
  file("1", "250301_Ruben.pdf"),
  file("2", "250704_Ruben.pdf", { Person: "Ruby" }),
  file("3", "PalmerGift.pdf"),
  file("4", "260901_Caleb.pdf"),
];

describe("planRule", () => {
  it("fills empty values from the pattern, reading dates", () => {
    const plan = planRule("r", statements, files, env());
    expect(plan.edits).toEqual([
      { file_id: "1", key: "Person", value: "Ruben" },
      { file_id: "1", key: "Date", value: "2025-03-01" },
      { file_id: "2", key: "Date", value: "2025-07-04" },
      { file_id: "4", key: "Person", value: "Caleb" },
      { file_id: "4", key: "Date", value: "2026-09-01" },
    ]);
    expect(plan.writes.find((w) => w.file_id === "1" && w.key === "Person")?.value).toBe('"Ruben"');
  });

  it("leaves existing values unless the action overwrites", () => {
    const keep = planRule("r", statements, [files[1]], env());
    expect(keep.edits.some((e) => e.key === "Person")).toBe(false);
    const over = planRule("r", { ...statements, actions: [{ ...statements.actions[0], overwrite: true }] }, [files[1]], env());
    expect(over.edits).toEqual([{ file_id: "2", key: "Person", value: "Ruben" }]);
  });

  it("doesn't touch files outside the conditions, and reports names that don't fit the pattern", () => {
    const plan = planRule("r", { ...statements, conditions: [...statements.conditions, { id: "c2", column: "ext", op: "has", value: "pdf" }] }, files, env());
    expect(plan.rows.find((r) => r.file.file_id === "3")?.status).toBe("nomatch");
    expect(plan.counts).toMatchObject({ match: 3, change: 3, nomatch: 1 });
    const narrow = planRule("r", { ...statements, conditions: [{ id: "c", column: "name", op: "contains", value: "Caleb" }] }, files, env());
    expect(narrow.rows.map((r) => r.file.file_id)).toEqual(["4"]);
  });

  it("never rewrites its own value once changed by hand", () => {
    const written = writeKeys([{ rule_id: "r", file_id: "1", key: "Person", value: '"Ruben"' }]);
    const changed = file("1", "250301_Ruben.pdf", { Person: "R. Smith" });
    const cleared = file("1", "250301_Ruben.pdf", {});
    for (const f of [changed, cleared]) {
      const plan = planRule("r", { ...statements, actions: [{ ...statements.actions[0], overwrite: true }] }, [f], env(written));
      expect(plan.edits).toEqual([]);
      expect(plan.rows[0].status).toBe("edited");
    }
  });

  it("adds to a Multi-select, but not a value taken off by hand", () => {
    const def: RuleDefinition = {
      match: "all",
      conditions: [{ id: "c", column: "name", op: "contains", value: "Burton" }],
      actions: [{ id: "a", property: "Tags", mode: "fixed", value: "House" }],
    };
    const f = file("9", "BurtonRd_Kitchen.pdf", { Tags: ["Invoice"] });
    expect(planRule("r", def, [f], env()).edits).toEqual([{ file_id: "9", key: "Tags", value: ["Invoice", "House"] }]);
    const removed = writeKeys([{ rule_id: "r", file_id: "9", key: "Tags", value: '"House"' }]);
    expect(planRule("r", def, [f], env(removed)).edits).toEqual([]);
  });

  it("runs formulas, and explains the ones that fail", () => {
    const def: RuleDefinition = {
      match: "all",
      conditions: [],
      actions: [{ id: "a", property: "Code", mode: "formula", value: "upper(slice(name, 3, 7))" }],
    };
    expect(planRule("r", def, [file("1", "Q3_ab12_final.docx")], env()).edits).toEqual([{ file_id: "1", key: "Code", value: "AB12" }]);
    const bad = planRule("r", { ...def, actions: [{ ...def.actions[0], value: "{Nope}" }] }, [file("1", "x.pdf")], env());
    expect(bad.rows[0]).toMatchObject({ status: "nomatch", problems: ["The pattern has no {Nope}"] });
  });

  it("skips properties that don't exist, and values that can't be read", () => {
    const def: RuleDefinition = {
      match: "all",
      conditions: [{ id: "c", column: "name", op: "matches", value: "{Date}_{*}" }],
      actions: [
        { id: "a", property: "Gone", mode: "fixed", value: "x" },
        { id: "b", property: "Date", mode: "slot", value: "Date", format: "YYMMDD" },
      ],
    };
    const plan = planRule("r", def, [file("1", "March_notes.pdf")], env());
    expect(plan.edits).toEqual([]);
    expect(plan.rows[0].problems).toEqual(["there's no property “Gone”", "“March” isn't a YYMMDD date"]);
  });
});

describe("planRules", () => {
  it("runs enabled rules in order; the first to fill a value wins", () => {
    const first = { rule_id: "a", library: "docs", name: "A", enabled: true, position: 0, definition: JSON.stringify({ ...statements, actions: [{ id: "x", property: "Person", mode: "fixed", value: "First" }] }) };
    const second = { ...first, rule_id: "b", position: 1, definition: JSON.stringify({ ...statements, actions: [{ id: "y", property: "Person", mode: "fixed", value: "Second" }] }) };
    const off = { ...first, rule_id: "c", enabled: false, definition: JSON.stringify({ ...statements, actions: [{ id: "z", property: "Code", mode: "fixed", value: "Off" }] }) };
    const { edits } = planRules([first, second, off], [files[0]], env());
    expect(edits).toEqual([{ file_id: "1", key: "Person", value: "First" }]);
  });
});

describe("definitions", () => {
  it("starts from the table's filters and search", () => {
    const def = definitionFromFilter(
      [
        { id: "1", column: "prop:Tags", op: "has", value: "Ruben" },
        { id: "2", column: "name", op: "contains", value: "  " },
      ],
      "any",
      "2025"
    );
    expect(def.match).toBe("any");
    expect(def.conditions.map((c) => [c.column, c.op, c.value])).toEqual([
      ["prop:Tags", "has", "Ruben"],
      ["name", "contains", "2025"],
    ]);
    expect(def.actions).toHaveLength(1);
  });

  it("lists the slots its patterns fill, and survives a damaged definition", () => {
    expect(ruleSlots(statements)).toEqual(["Date", "Person"]);
    expect(parseDefinition("{oops").conditions).toEqual([]);
    expect(parseDefinition(JSON.stringify({ actions: [{ property: "X" }] })).actions[0]).toMatchObject({ property: "X", mode: "fixed" });
  });
});
