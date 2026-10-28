import { describe, it, expect } from "vitest";
import { formatForSlot, columnByName, columnPart, definitionFromFilter, parseDefinition, planRule, planRules, ruleSlots, withFilterConditions, writeKeys, type RuleDefinition, type RuleEnv } from "./rules";
import { parseDateAs } from "./patterns";
import { PROP_PREFIX, nativeValue, NATIVE_KINDS, KIND_BY_TYPE, metaValue } from "./fileColumns";
import type { FileRecord, ValueType } from "../types";

const file = (id: string, path: string, metadata: Record<string, unknown> = {}): FileRecord =>
  ({ file_id: id, file_path: `/docs/${path}`, relative_path: path, metadata, tags: [] }) as unknown as FileRecord;

const types: Record<string, ValueType> = {
  Person: "enum",
  Date: "date",
  Tags: "array",
  Code: "free_text",
  Amount: "number",
  Test: "enum",
  Rig: "enum",
  Project: "enum",
  Rigs: "array",
};
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
    // …unless Apply Now includes values changed by hand
    const over = planRule("r", { ...statements, actions: [statements.actions[0]] }, [changed], { ...env(written), overHandEdits: true });
    expect(over.edits).toEqual([{ file_id: "1", key: "Person", value: "Ruben" }]);
  });

  it("updates its own values when the rule changes, overwrite or not", () => {
    // It wrote "Rubn" (a mistake), and the value is still that: not a hand edit
    const written = writeKeys([{ rule_id: "r", file_id: "1", key: "Person", value: '"Rubn"' }]);
    const f = file("1", "250301_Ruben.pdf", { Person: "Rubn" });
    const plan = planRule("r", { ...statements, actions: [statements.actions[0]] }, [f], env(written));
    expect(plan.edits).toEqual([{ file_id: "1", key: "Person", value: "Ruben" }]);
    expect(plan.rows[0].status).toBe("change");
  });

  it("takes back Multi-select items it added that it no longer gives", () => {
    const def: RuleDefinition = {
      match: "all",
      conditions: [{ id: "c", column: "name", op: "contains", value: "Burton" }],
      actions: [{ id: "a", property: "Tags", mode: "fixed", value: "House" }],
    };
    // It added "0014" before; "Invoice" was there already
    const written = writeKeys([{ rule_id: "r", file_id: "9", key: "Tags", value: '"0014"' }]);
    const f = file("9", "BurtonRd_Kitchen.pdf", { Tags: ["Invoice", "0014"] });
    expect(planRule("r", def, [f], env(written)).edits).toEqual([{ file_id: "9", key: "Tags", value: ["Invoice", "House"] }]);
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

  it("reads a date and time from a camera's file name into a Date", () => {
    const def: RuleDefinition = {
      match: "all",
      conditions: [{ id: "c", column: "name", op: "matches", value: "IMG_{Taken:15}.jpg" }],
      actions: [{ id: "a", property: "Date", mode: "slot", value: "Taken", format: "YYYYMMDD_HHmmss" }],
    };
    expect(planRule("r", def, [file("1", "IMG_20240301_101522.jpg")], env()).edits).toEqual([
      { file_id: "1", key: "Date", value: "2024-03-01T10:15:22" },
    ]);
    expect(formatForSlot("yyyymmdd_hhmmss")).toBe("YYYYMMDD_HHmmss");
  });

  it("reads OneDrive's camera upload names, whose time is UTC", () => {
    const def: RuleDefinition = {
      match: "all",
      conditions: [{ id: "c", column: "name", op: "matches", value: "{Taken:18}_iOS" }],
      actions: [{ id: "a", property: "Date", mode: "slot", value: "Taken", format: "YYYYMMDD_HHmmssSSS (UTC)" }],
    };
    const [edit] = planRule("r", def, [file("1", "20250610_094446600_iOS.heic")], env()).edits;
    expect(edit.value).toBe(parseDateAs("20250610_094446600", "YYYYMMDD_HHmmssSSS (UTC)"));
    expect(new Date(String(edit.value)).toISOString()).toBe("2025-06-10T09:44:46.000Z");
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

  it("starts from the folder the table is in, ahead of its filters", () => {
    const place = [{ id: "p", column: "prop:Person", op: "is" as const, value: "Josh" }];
    const one = definitionFromFilter([{ id: "1", column: "ext", op: "has", value: "pdf" }], "any", "", place);
    expect(one.match).toBe("all");
    expect(one.conditions.map((c) => [c.column, c.value])).toEqual([
      ["prop:Person", "Josh"],
      ["ext", "pdf"],
    ]);
    expect(definitionFromFilter([], "all", "", place).conditions).toHaveLength(1);
    // "Any of" several filters can't also require the folder
    const any = definitionFromFilter([{ id: "1", column: "ext", op: "has", value: "pdf" }], "any", "2025", place);
    expect(any.match).toBe("any");
    expect(any.conditions.map((c) => c.column)).toEqual(["ext", "name"]);
  });

  it("adds the filter's conditions it doesn't already have", () => {
    const filter = definitionFromFilter(
      [
        { id: "1", column: "prop:Tags", op: "has", value: "Ruben" },
        { id: "2", column: "ext", op: "is", value: "pdf" },
      ],
      "any",
      ""
    );
    const empty = withFilterConditions(definitionFromFilter([], "all", ""), filter);
    expect(empty.match).toBe("any");
    expect(empty.conditions).toHaveLength(2);

    const own = definitionFromFilter([{ id: "x", column: "ext", op: "is", value: "pdf" }], "all", "");
    const merged = withFilterConditions(own, filter);
    expect(merged.match).toBe("all");
    expect(merged.conditions.map((c) => [c.column, c.value])).toEqual([
      ["ext", "pdf"],
      ["prop:Tags", "Ruben"],
    ]);
    expect(withFilterConditions(merged, filter)).toBe(merged);
  });

  it("lists the slots its patterns fill, and survives a damaged definition", () => {
    expect(ruleSlots(statements)).toEqual(["Date", "Person"]);
    expect(parseDefinition("{oops").conditions).toEqual([]);
    expect(parseDefinition(JSON.stringify({ actions: [{ property: "X" }] })).actions[0]).toMatchObject({ property: "X", mode: "fixed" });
  });
});

describe("values from other columns", () => {
  const f = (id: string, path: string, extra: Partial<FileRecord> = {}, metadata: Record<string, unknown> = {}) =>
    ({ ...file(id, path, metadata), ...extra }) as FileRecord;
  const withTags = (id: string, path: string, created: string, metadata: Record<string, unknown> = {}) =>
    f(id, path, { tags: path.split("/").slice(0, -1), timestamp: created } as Partial<FileRecord>, metadata);

  it("matches a pattern against any one of a list's items", () => {
    const def: RuleDefinition = {
      match: "all",
      conditions: [{ id: "c", column: "tags", op: "matches", value: "{Year:4} {Client}" }],
      actions: [{ id: "a", property: "Person", mode: "slot", value: "Client" }],
    };
    const plan = planRule("r", def, [withTags("1", "Work/2024 Acme/brief.pdf", "2024-05-01"), withTags("2", "Home/x.pdf", "2024-05-01")], env());
    expect(plan.edits).toEqual([{ file_id: "1", key: "Person", value: "Acme" }]);
  });

  it("copies another column's value, or a part of it", () => {
    const files = [withTags("1", "Clients/Acme/2024/brief.pdf", "2025-03-01T09:30:00Z")];
    const year: RuleDefinition = {
      match: "all",
      conditions: [],
      actions: [
        { id: "a", property: "Code", mode: "column", value: "created", part: "year" },
        { id: "b", property: "Person", mode: "column", value: "tags", part: "n:2" },
        { id: "c", property: "Tags", mode: "column", value: "tags", part: "all" },
        { id: "d", property: "Date", mode: "column", value: "created", part: "date" },
      ],
    };
    expect(planRule("r", year, files, env()).edits).toEqual([
      { file_id: "1", key: "Code", value: "2025" },
      { file_id: "1", key: "Person", value: "Acme" },
      { file_id: "1", key: "Tags", value: ["Clients", "Acme", "2024"] },
      { file_id: "1", key: "Date", value: "2025-03-01" },
    ]);
  });

  it("picks parts of lists and dates", () => {
    expect(columnPart(["a", "b", "c"], "last")).toBe("c");
    expect(columnPart(["a", "b", "c"], "first")).toBe("a");
    expect(columnPart(["a"], "n:3")).toBeNull();
    expect(columnPart("2025-03-01", "yearMonth")).toBe("2025-03");
    expect(columnPart("2025-03-01", "quarter")).toBe("Q1");
    expect(columnPart("2025-03-01", "monthName")).toBe("March");
    expect(columnPart("2025-03-01T10:15:22", "date")).toBe("2025-03-01");
    expect(columnPart("2025-03-01T10:15:22", "dateTime")).toBe("2025-03-01T10:15:22");
    expect(columnPart("2025-03-01T10:15:22", "time")).toBe("10:15");
    expect(columnPart("2025-03-01T10:15:22", "hour")).toBe("10");
    expect(columnPart("2025-03-01", "time")).toBeNull();
    expect(columnPart("Acme", "year")).toBe("Acme");
    expect(columnPart(null, "year")).toBeNull();
  });

  it("finds columns by their header names", () => {
    expect(columnByName("Created")).toBe("created");
    expect(columnByName("path tags")).toBe("tags");
    // Formulas written before Source Tags was renamed still read it
    expect(columnByName("Source Tags")).toBe("tags");
    expect(columnByName("Client")).toBe("prop:Client");
  });

  it("lets conditions on type and date pick the files", () => {
    const def: RuleDefinition = {
      match: "all",
      conditions: [
        { id: "k", column: "type", op: "has", value: "PDF Documents" },
        { id: "d1", column: "created", op: "after", value: "2024-12-31" },
        { id: "d2", column: "created", op: "before", value: "2026-01-01" },
      ],
      actions: [{ id: "a", property: "Code", mode: "formula", value: 'kind & "-" & year(created)' }],
    };
    const files = [
      withTags("1", "a.pdf", "2025-06-01"),
      withTags("2", "b.pdf", "2023-06-01"),
      withTags("3", "c.jpg", "2025-06-01"),
    ];
    expect(planRule("r", def, files, env()).edits).toEqual([{ file_id: "1", key: "Code", value: "PDF Documents-2025" }]);
  });
});

describe("patterns on one folder", () => {
  const withTags = (id: string, path: string) =>
    ({ ...file(id, path), tags: path.split("/").slice(0, -1) }) as unknown as FileRecord;
  const def = (item: string): RuleDefinition => ({
    match: "all",
    conditions: [{ id: "c", column: "tags", op: "matches", value: "{Year:4} {Client}", item }],
    actions: [{ id: "a", property: "Person", mode: "slot", value: "Client" }],
  });
  // The top folder fits the pattern; the folder the file is in doesn't
  const files = [withTags("1", "2024 Acme/Invoices/x.pdf"), withTags("2", "Work/2023 Globex/y.pdf")];

  it("tries only the chosen folder", () => {
    expect(planRule("r", def("first"), files, env()).edits).toEqual([{ file_id: "1", key: "Person", value: "Acme" }]);
    expect(planRule("r", def("last"), files, env()).edits).toEqual([{ file_id: "2", key: "Person", value: "Globex" }]);
    expect(planRule("r", def("n:2"), files, env()).edits).toEqual([{ file_id: "2", key: "Person", value: "Globex" }]);
    expect(planRule("r", def("any"), files, env()).edits).toHaveLength(2);
  });
});

describe("dates from slots", () => {
  const def = (format?: string): RuleDefinition => ({
    match: "all",
    conditions: [{ id: "c", column: "name", op: "matches", value: "{Test:4}-{YYMMDD:6}" }],
    actions: [{ id: "a", property: "Date", mode: "slot", value: "YYMMDD", format }],
  });

  it("won't write text that isn't a date into a Date property", () => {
    const plan = planRule("r", def(), [file("1", "0014-250701.jpg")], env());
    expect(plan.edits).toEqual([]);
    expect(plan.rows[0].problems[0]).toMatch(/isn't a date/);
  });

  it("reads it once told how", () => {
    expect(planRule("r", def("YYMMDD"), [file("1", "0014-250701.jpg")], env()).edits).toEqual([
      { file_id: "1", key: "Date", value: "2025-07-01" },
    ]);
  });

  it("takes the format from a slot named after one", () => {
    expect(formatForSlot("YYMMDD")).toBe("YYMMDD");
    expect(formatForSlot("yyyymmdd")).toBe("YYYYMMDD");
    expect(formatForSlot("Test")).toBe("");
  });
});

describe("nothing to write", () => {
  it("says why when the property is empty, rather than calling it already set", () => {
    const def: RuleDefinition = {
      match: "all",
      conditions: [{ id: "c", column: "name", op: "matches", value: "{Date:8 digits}_{Time:6 digits}" }],
      actions: [{ id: "a", property: "Code", mode: "formula", value: '""' }],
    };
    const row = planRule("r", def, [file("1", "20250619_113501.jpg")], env()).rows[0];
    expect(row).toMatchObject({ status: "nomatch", problems: ["the formula gives nothing"] });
    // With a value there already, nothing to write is fine
    const set = planRule("r", def, [file("1", "20250619_113501.jpg", { Code: "x" })], env()).rows[0];
    expect(set.status).toBe("set");
  });

  it("shows a date the formula can't read as a problem", () => {
    const def: RuleDefinition = {
      match: "all",
      conditions: [{ id: "c", column: "name", op: "matches", value: "{Date:8 digits}_{Time:6 digits}" }],
      actions: [{ id: "a", property: "Date", mode: "formula", value: 'date({Date} & {Time}, "YYYYMMDD_HHmmss")' }],
    };
    const row = planRule("r", def, [file("1", "20250619_113501.jpg")], env()).rows[0];
    expect(row.status).toBe("nomatch");
    expect(row.problems[0]).toMatch(/isn't a YYYYMMDD_HHmmss date/);
  });
});

describe("from files with the same …", () => {
  const rigFromTest: RuleDefinition = {
    match: "all",
    conditions: [],
    actions: [{ id: "a", property: "Rig", mode: "same", value: "prop:Test" }],
  };

  it("fills a property from files sharing a value, and leaves the rest", () => {
    const plan = planRule("r", rigFromTest, [
      file("1", "a.jpg", { Test: "1", Rig: "A1" }),
      file("2", "b.jpg", { Test: "1" }),
      file("3", "c.jpg", { Test: "2" }),
      file("4", "d.jpg", {}),
    ], env());
    expect(plan.edits).toEqual([{ file_id: "2", key: "Rig", value: "A1" }]);
    expect(plan.rows.find((r) => r.file.file_id === "2")?.sources).toEqual([{ column: "prop:Test", text: "1" }]);
  });

  it("writes nothing where those files disagree, and says how", () => {
    const plan = planRule("r", rigFromTest, [
      file("1", "a.jpg", { Test: "1", Rig: "A1" }),
      file("2", "b.jpg", { Test: "1", Rig: "A1" }),
      file("3", "c.jpg", { Test: "1", Rig: "A2" }),
      file("4", "d.jpg", { Test: "1" }),
    ], env());
    expect(plan.edits).toEqual([]);
    expect(plan.rows.find((r) => r.file.file_id === "4")).toMatchObject({
      status: "nomatch",
      problems: ["Test 1 is on Rig A1 in 2 files, A2 in 1 file"],
    });
  });

  it("matches on every column chosen", () => {
    const def: RuleDefinition = { ...rigFromTest, actions: [{ ...rigFromTest.actions[0], also: ["prop:Project"] }] };
    const plan = planRule("r", def, [
      file("1", "a.jpg", { Test: "1", Project: "X", Rig: "A1" }),
      file("2", "b.jpg", { Test: "1", Project: "Y", Rig: "B1" }),
      file("3", "c.jpg", { Test: "1", Project: "Y" }),
      file("4", "d.jpg", { Test: "1" }),
    ], env());
    expect(plan.edits).toEqual([{ file_id: "3", key: "Rig", value: "B1" }]);
  });

  it("learns from files outside the conditions, but fills only those meeting them", () => {
    const def: RuleDefinition = { ...rigFromTest, conditions: [{ id: "c", column: "ext", op: "has", value: "pdf" }] };
    const plan = planRule("r", def, [
      file("1", "a.jpg", { Test: "1", Rig: "A1" }),
      file("2", "b.jpg", { Test: "1" }),
      file("3", "c.pdf", { Test: "1" }),
    ], env());
    expect(plan.edits).toEqual([{ file_id: "3", key: "Rig", value: "A1" }]);
  });

  it("copies a Multi-select as a list; lists that differ disagree", () => {
    const def: RuleDefinition = { ...rigFromTest, actions: [{ id: "a", property: "Rigs", mode: "same", value: "prop:Test" }] };
    const agree = planRule("r", def, [
      file("1", "a.jpg", { Test: "1", Rigs: ["A1", "A2"] }),
      file("2", "b.jpg", { Test: "1", Rigs: ["a2", "A1"] }),
      file("3", "c.jpg", { Test: "1" }),
    ], env());
    expect(agree.edits).toEqual([{ file_id: "3", key: "Rigs", value: ["A1", "A2"] }]);
    const differ = planRule("r", def, [
      file("1", "a.jpg", { Test: "1", Rigs: ["A1", "A2"] }),
      file("2", "b.jpg", { Test: "1", Rigs: ["A1"] }),
      file("3", "c.jpg", { Test: "1" }),
    ], env());
    expect(differ.edits).toEqual([]);
  });

  it("counts a file's own value: one that disagrees holds the rest back until it's fixed", () => {
    const files = [file("1", "a.jpg", { Test: "1", Rig: "A1" }), file("2", "b.jpg", { Test: "1", Rig: "Z" }), file("3", "c.jpg", { Test: "1" })];
    const plan = planRule("r", rigFromTest, files, env());
    expect(plan.edits).toEqual([]);
    expect(plan.rows.find((r) => r.file.file_id === "3")?.problems).toEqual(["Test 1 is on Rig A1 in 1 file, Z in 1 file"]);
  });

  it("never rewrites its own value once changed by hand", () => {
    const written = writeKeys([{ rule_id: "r", file_id: "2", key: "Rig", value: '"A1"' }]);
    const files = [file("1", "a.jpg", { Test: "1", Rig: "A1" }), file("2", "b.jpg", { Test: "1" })];
    const plan = planRule("r", rigFromTest, files, env(written));
    expect(plan.edits).toEqual([]);
    expect(plan.rows.find((r) => r.file.file_id === "2")?.status).toBe("edited");
  });
});

describe("what the preview shows", () => {
  it("records the folder a pattern fitted and the values it picked", () => {
    const f = { ...file("1", "06 Photos/0014-250701/20250701_161305.jpg"), tags: ["06 Photos", "0014-250701"] } as unknown as FileRecord;
    const def: RuleDefinition = {
      match: "all",
      conditions: [{ id: "c", column: "tags", op: "matches", value: "{Test:4}-{YYMMDD:6}" }],
      actions: [{ id: "a", property: "Date", mode: "slot", value: "YYMMDD", format: "YYMMDD" }],
    };
    const row = planRule("r", def, [f], env()).rows[0];
    expect(row.sources).toEqual([{ column: "tags", text: "0014-250701" }]);
    expect(row.slots).toEqual({ Test: "0014", YYMMDD: "250701" });
    expect(row.changes).toEqual([{ property: "Date", from: null, to: "2025-07-01" }]);
  });

  it("shows what was there when a pattern doesn't fit", () => {
    const f = { ...file("2", "06 Photos/misc/x.jpg"), tags: ["06 Photos", "misc"] } as unknown as FileRecord;
    const def: RuleDefinition = {
      match: "all",
      conditions: [{ id: "c", column: "tags", op: "matches", value: "{Test:4}-{YYMMDD:6}", item: "last" }],
      actions: [{ id: "a", property: "Date", mode: "slot", value: "YYMMDD", format: "YYMMDD" }],
    };
    const row = planRule("r", def, [f], env()).rows[0];
    expect(row.status).toBe("nomatch");
    expect(row.sources).toEqual([{ column: "tags", text: "misc" }]);
  });
});
