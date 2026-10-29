import { describe, expect, it } from "vitest";
import { planDrop, type DragItem, type DropContext } from "./filing";
import { NO_VALUE, folderTree } from "./folderTree";
import { impliedByFile, valueReader } from "./fileValues";
import type { FilterRule } from "./dbTable";
import type { Scope } from "./scopes";
import type { FolderLevel } from "./tableViews";
import type { FileRecord, ValueType } from "../types";

const file = (id: string, metadata: Record<string, unknown>, type = "pdf"): FileRecord => ({
  file_id: id,
  file_path: `/root/${id}.${type}`,
  relative_path: `${id}.${type}`,
  file_type: type === "pdf" ? "application/pdf" : "image/jpeg",
  timestamp: "2024-03-12T10:00:00Z",
  library: "docs",
  metadata,
  tags: [],
});

const TYPES: Record<string, ValueType> = { Client: "enum", Project: "array", Due: "date", Housing: "enum", Tags: "array", Count: "number" };
const typeOf = (name: string): ValueType => TYPES[name] ?? "free_text";
const label = (column: string) => column.replace(/^prop:/, "").replace(/^type$/, "Kind");

const level = (column: string, next: FolderLevel | null = null): FolderLevel => ({ column, direction: "asc", next, branches: {} });

function context(files: FileRecord[], root: FolderLevel | null, scopes: Scope[] = [], filters: FilterRule[] = []): DropContext {
  const reader = valueReader({ typeOf, scopes, implied: impliedByFile(files, scopes, (p) => typeOf(p) === "array") });
  return { tree: folderTree(files, root, reader, typeOf, label), root, typeOf, scopes, filters, match: "all", label, topLabel: "Work" };
}

const drag = (f: FileRecord, from: string[] | null): DragItem => ({ kind: "file", file: f, from });

describe("planDrop", () => {
  it("sets the folder's value on a file without one, silently", () => {
    const loose = file("1", {});
    const ctx = context([loose, file("2", { Client: "Acme" })], level("prop:Client"));
    const plan = planDrop([drag(loose, [NO_VALUE])], ["Acme"], ctx);
    expect(plan.edits).toEqual([{ file_id: "1", key: "Client", value: "Acme" }]);
    expect(plan.before).toEqual([{ file_id: "1", key: "Client", value: null }]);
    expect(plan.replacements).toEqual([]);
    expect(plan.verb).toBe("Set");
    expect(plan.title).toBe("Set Client to Acme");
  });

  it("moves a file between sibling folders without asking", () => {
    const f = file("1", { Client: "Acme" });
    const ctx = context([f, file("2", { Client: "Globex" })], level("prop:Client"));
    const plan = planDrop([drag(f, ["Acme"])], ["Globex"], ctx);
    expect(plan.edits).toEqual([{ file_id: "1", key: "Client", value: "Globex" }]);
    expect(plan.replacements).toEqual([]);
    expect(plan.title).toBe("Move to “Globex”");
  });

  it("asks before replacing a value that wasn't visible from the drag", () => {
    const f = file("1", { Client: "Acme" });
    const ctx = context([f, file("2", { Client: "Globex" })], level("prop:Client"));
    const plan = planDrop([drag(f, null)], ["Globex"], ctx);
    expect(plan.replacements).toEqual([{ fileId: "1", level: "Client", was: "Acme", now: "Globex" }]);
    expect(plan.details[0]).toBe("Client: Globex (1 replaced)");

    // Keep Existing leaves it alone
    const kept = planDrop([drag(f, null)], ["Globex"], ctx, { replace: false });
    expect(kept.edits).toEqual([]);
    expect(kept.refusal).toBe("Can't go here: already has a Client");
  });

  it("swaps only the dragged-from value of a Multi-select, keeping its others", () => {
    const f = file("1", { Project: ["Apollo", "Hermes"] });
    const ctx = context([f, file("2", { Project: ["Zeus"] })], level("prop:Project"));
    const plan = planDrop([drag(f, ["Apollo"])], ["Zeus"], ctx);
    expect(plan.edits).toEqual([{ file_id: "1", key: "Project", value: ["Hermes", "Zeus"] }]);
    expect(plan.replacements).toEqual([]);
    expect(plan.verb).toBe("Move");
  });

  it("adds instead with Option, so the file is in both folders", () => {
    const f = file("1", { Project: ["Apollo"] });
    const ctx = context([f, file("2", { Project: ["Zeus"] })], level("prop:Project"));
    const plan = planDrop([drag(f, ["Apollo"])], ["Zeus"], ctx, { add: true });
    expect(plan.edits).toEqual([{ file_id: "1", key: "Project", value: ["Apollo", "Zeus"] }]);
    expect(plan.verb).toBe("Add");
    expect(plan.title).toBe("Add to “Zeus”");
  });

  it("adds to a Multi-select when the file comes from elsewhere", () => {
    const f = file("1", { Project: ["Apollo"] });
    const ctx = context([f, file("2", { Project: ["Zeus"] })], level("prop:Project"));
    const plan = planDrop([drag(f, null)], ["Zeus"], ctx);
    expect(plan.edits).toEqual([{ file_id: "1", key: "Project", value: ["Apollo", "Zeus"] }]);
    expect(plan.replacements).toEqual([]);
  });

  it("sets every value on a deep path", () => {
    const loose = file("1", {});
    const ctx = context([loose, file("2", { Client: "Globex", Project: ["Zeus"] })], level("prop:Client", level("prop:Project")));
    const plan = planDrop([drag(loose, [])], ["Globex", "Zeus"], ctx);
    expect(plan.edits).toEqual([
      { file_id: "1", key: "Client", value: "Globex" },
      { file_id: "1", key: "Project", value: ["Zeus"] },
    ]);
    expect(plan.title).toBe("Move to “Zeus”");
  });

  it("only lets files into a level read from the file where they already are", () => {
    const pdf = file("1", {});
    const photo = file("2", { Client: "Acme" }, "jpg");
    const ctx = context([pdf, photo], level("type", level("prop:Client")));
    const [first, second] = ctx.tree.contents([]).folders.map((f) => f.value);
    const pdfKind = ctx.tree.filesAt([first]).includes(pdf) ? first : second;
    const photoKind = pdfKind === first ? second : first;

    expect(planDrop([drag(pdf, [pdfKind])], [pdfKind, "Acme"], ctx).edits).toEqual([{ file_id: "1", key: "Client", value: "Acme" }]);
    const refused = planDrop([drag(pdf, [pdfKind])], [photoKind, "Acme"], ctx);
    expect(refused.edits).toEqual([]);
    expect(refused.refusal).toBe("Can't go here: Kind is read from the file");
  });

  it("sets a date property to a one-day folder's day", () => {
    const f = file("1", {});
    const ctx = context([f, file("2", { Due: "2024-03-12" })], { ...level("prop:Due"), dateUnit: "day" });
    const plan = planDrop([drag(f, null)], ["2024-03-12"], ctx);
    expect(plan.edits).toEqual([{ file_id: "1", key: "Due", value: "2024-03-12" }]);
    expect(plan.asks).toEqual([]);
  });

  it("asks which day for a folder of several, then sets the one chosen", () => {
    const f = file("1", {});
    const ctx = context([f, file("2", { Due: "2024-02-01" })], { ...level("prop:Due"), dateUnit: "month" });
    const plan = planDrop([drag(f, null)], ["2024-02"], ctx);
    expect(plan.asks).toEqual([{ column: "prop:Due", level: "Due", folder: "February 2024", first: "2024-02-01", last: "2024-02-29" }]);
    expect(plan.details).toContain("Due: asks which day");
    const chosen = planDrop([drag(f, null)], ["2024-02"], ctx, { dates: { "prop:Due": "2024-02-14" } });
    expect(chosen.asks).toEqual([]);
    expect(chosen.edits).toEqual([{ file_id: "1", key: "Due", value: "2024-02-14" }]);
  });

  it("moves a date between its folders, and asks before replacing one not dragged from", () => {
    const f = file("1", { Due: "2023-05-01" });
    const ctx = context([f, file("2", { Due: "2024-02-01" })], { ...level("prop:Due"), dateUnit: "year" });
    expect(planDrop([drag(f, ["2023"])], ["2024"], ctx, { dates: { "prop:Due": "2024-06-01" } }).replacements).toEqual([]);
    expect(planDrop([drag(f, null)], ["2024"], ctx).replacements).toEqual([
      { fileId: "1", level: "Due", was: "2023-05-01", now: "2024-01-01" },
    ]);
  });

  it("leaves a date to the Database view where a folder has no one day (a month of every year)", () => {
    const f = file("1", { Due: "2023-05-01" });
    const ctx = context([f, file("2", { Due: "2024-02-01" })], { ...level("prop:Due"), dateUnit: "monthOfYear" });
    expect(planDrop([drag(f, null)], ["02"], ctx).refusal).toBe("Can't go here: Due is a date: set it in the Database view");
  });

  it("files only those that can go, and says why the others can't", () => {
    const pdf = file("1", {});
    const photo = file("2", {}, "jpg");
    const ctx = context([pdf, photo, file("3", { Client: "Acme" })], level("type", level("prop:Client")));
    const pdfKind = ctx.tree.contents([]).folders.find((f) => ctx.tree.filesAt([f.value]).includes(pdf))!.value;
    const plan = planDrop([drag(pdf, [pdfKind]), drag(photo, null)], [pdfKind, "Acme"], ctx);
    expect(plan.files).toBe(1);
    expect(plan.left).toEqual({ count: 1, reason: "Kind is read from the file" });
    expect(plan.details).toContain("1 can't go here: Kind is read from the file");
  });

  it("drops a folder's files, from that folder", () => {
    const a = file("1", { Client: "Acme" });
    const b = file("2", { Client: "Acme" });
    const ctx = context([a, b, file("3", { Client: "Globex" })], level("prop:Client"));
    const plan = planDrop([{ kind: "folder", path: ["Acme"] }], ["Globex"], ctx);
    expect(plan.files).toBe(2);
    expect(plan.replacements).toEqual([]);
    expect(planDrop([{ kind: "folder", path: ["Acme"] }], ["Acme"], ctx).files).toBe(0);
  });

  it("won't put a folder inside itself", () => {
    const f = file("1", { Client: "Acme", Project: ["Apollo"] });
    const ctx = context([f], level("prop:Client", level("prop:Project")));
    expect(planDrop([{ kind: "folder", path: ["Acme"] }], ["Acme", "Apollo"], ctx).refusal).toBe("“Acme” can't go inside itself");
  });

  it("takes a file out of the folders below the one it's dragged up to", () => {
    const f = file("1", { Client: "Acme", Project: ["Apollo", "Hermes"] });
    const ctx = context([f], level("prop:Client", level("prop:Project")));
    const plan = planDrop([drag(f, ["Acme", "Apollo"])], ["Acme"], ctx);
    expect(plan.edits).toEqual([{ file_id: "1", key: "Project", value: ["Hermes"] }]);
  });

  it("removes from a folder the view's filters require, when asked to whatever", () => {
    const f = file("1", { Project: ["Apollo"] });
    const filters: FilterRule[] = [{ id: "f", column: "prop:Project", op: "not_empty", value: "" }];
    const ctx = context([f], level("prop:Project"), [], filters);
    expect(planDrop([drag(f, ["Apollo"])], [], ctx).files).toBe(0);
    expect(planDrop([drag(f, ["Apollo"])], [], ctx, { partial: true }).edits).toEqual([{ file_id: "1", key: "Project", value: null }]);
  });

  it("does nothing where the file already is", () => {
    const f = file("1", { Client: "Acme" });
    const ctx = context([f], level("prop:Client"));
    const plan = planDrop([drag(f, ["Acme"])], ["Acme"], ctx);
    expect(plan).toMatchObject({ files: 0, refusal: null, edits: [] });
  });

  it("clears the value into the No folder, asking only for values not dragged from", () => {
    const f = file("1", { Client: "Acme" });
    const ctx = context([f, file("2", {})], level("prop:Client"));
    const fromFolder = planDrop([drag(f, ["Acme"])], [NO_VALUE], ctx);
    expect(fromFolder.edits).toEqual([{ file_id: "1", key: "Client", value: null }]);
    expect(fromFolder.replacements).toEqual([]);
    expect(planDrop([drag(f, null)], [NO_VALUE], ctx).replacements).toEqual([
      { fileId: "1", level: "Client", was: "Acme", now: "No Client" },
    ]);
  });

  it("writes numbers as numbers", () => {
    const f = file("1", {});
    const ctx = context([f, file("2", { Count: 3 })], level("prop:Count"));
    expect(planDrop([drag(f, null)], ["3"], ctx).edits).toEqual([{ file_id: "1", key: "Count", value: 3 }]);
  });

  it("files into a conditional property's folder, its condition implied", () => {
    const scopes: Scope[] = [{ property: "Housing", conditions: [{ property: "Tags", value: "housing" }] }];
    const f = file("1", {});
    const ctx = context([f, file("2", { Housing: "Rent" })], { ...level("prop:Housing"), noValue: "loose" }, scopes);
    const plan = planDrop([drag(f, [])], ["Rent"], ctx);
    expect(plan.edits).toEqual([{ file_id: "1", key: "Housing", value: "Rent" }]);
    expect(plan.left).toBeNull();
  });

  it("leaves out files the view's filters would hide afterwards", () => {
    const f = file("1", {});
    const filters: FilterRule[] = [{ id: "f", column: "prop:Client", op: "has_not", value: "Globex" }];
    const ctx = context([f, file("2", { Client: "Globex" })], level("prop:Client"), [], filters);
    expect(planDrop([drag(f, null)], ["Globex"], ctx).refusal).toBe("Can't go here: the view's filters would leave it out");
    // Added from outside, it keeps the values anyway
    expect(planDrop([drag(f, null)], ["Globex"], ctx, { partial: true }).files).toBe(1);
  });
});
