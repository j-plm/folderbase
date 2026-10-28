import { describe, expect, it, vi } from "vitest";
import {
  NO_VALUE,
  folderConditions,
  folderTree,
  pinPlace,
  enclosingPlace,
  skipSingles,
  levelAt,
  folderGroupPath,
  folderGroups,
  levelsBelow,
  placeFilterRules,
  placeFilters,
  placeSteps,
  placeWithin,
  seedFromGroups,
  viewFiles,
} from "./folderTree";
import { applyFilters } from "./dbTable";
import { impliedByFile, valueReader } from "./fileValues";
import type { Scope } from "./scopes";
import type { FolderLevel } from "./tableViews";
import type { FileRecord, ValueType } from "../types";

const file = (id: string, metadata: Record<string, unknown>, path = `${id}.pdf`): FileRecord => ({
  file_id: id,
  file_path: `/root/${path}`,
  relative_path: path,
  file_type: "pdf",
  timestamp: null,
  library: "docs",
  metadata,
  tags: path.split("/").slice(0, -1),
});

const TYPES: Record<string, ValueType> = { Client: "enum", Project: "array", Year: "number", Due: "date", Housing: "enum", Tags: "array" };
const typeOf = (name: string): ValueType => TYPES[name] ?? "free_text";
const label = (column: string) => column.replace(/^prop:/, "");

function treeFor(files: FileRecord[], root: FolderLevel | null, scopes: Scope[] = []) {
  const reader = valueReader({ typeOf, scopes, implied: impliedByFile(files, scopes, (p) => typeOf(p) === "array") });
  return folderTree(files, root, reader, typeOf, label);
}

const level = (column: string, next: FolderLevel | null = null, branches: Record<string, FolderLevel | null> = {}): FolderLevel => ({
  column,
  direction: "asc",
  next,
  branches,
});

const files = [
  file("1", { Client: "Acme", Project: ["Apollo", "Hermes"], Year: 2024 }),
  file("2", { Client: "Acme", Project: ["Apollo"], Year: 2023 }),
  file("3", { Client: "Globex", Project: [], Year: 2024 }),
  file("4", {}),
];

describe("folderTree", () => {
  it("makes a folder per value, with the files at the bottom", () => {
    const tree = treeFor(files, level("prop:Client", level("prop:Year")));
    const top = tree.contents([]);
    expect(top.folders.map((f) => [f.label, f.count])).toEqual([["Acme", 2], ["Globex", 1], ["No Client", 1]]);
    expect(top.files).toEqual([]);
    expect(tree.contents(["Acme"]).folders.map((f) => f.value)).toEqual(["2023", "2024"]);
    expect(tree.contents(["Acme", "2024"])).toEqual({ level: null, folders: [], files: [files[0]] });
  });

  it("puts a Multi-select file in a folder for each of its values", () => {
    const tree = treeFor(files, level("prop:Project"));
    const folders = tree.contents([]).folders;
    expect(folders.map((f) => [f.value, f.count])).toEqual([["Apollo", 2], ["Hermes", 1], [NO_VALUE, 2]]);
    expect(tree.filesAt(["Hermes"]).map((f) => f.file_id)).toEqual(["1"]);
  });

  it("puts a file in every folder it's in on disk for Path Tags", () => {
    const tree = treeFor([file("1", {}, "Clients/Acme/x.pdf")], level("tags"));
    expect(tree.valuesAt([])).toEqual(["Acme", "Clients"]);
  });

  it("runs a descending level backwards, with No value still last", () => {
    const tree = treeFor(files, { ...level("prop:Year"), direction: "desc" });
    expect(tree.valuesAt([])).toEqual(["2024", "2023", NO_VALUE]);
  });

  it("follows a branch inside the folders that have one", () => {
    const root = level("prop:Client", level("prop:Year"), { Globex: level("prop:Project"), [NO_VALUE]: null });
    const tree = treeFor(files, root);
    expect(tree.contents(["Acme"]).level?.column).toBe("prop:Year");
    expect(tree.contents(["Globex"]).level?.column).toBe("prop:Project");
    expect(tree.contents([NO_VALUE]).files.map((f) => f.file_id)).toEqual(["4"]);
    expect(tree.contents([]).folders.find((f) => f.value === "Globex")?.inside?.column).toBe("prop:Project");
  });

  it("puts a conditional property's files without a value loose, or all in its No folder", () => {
    const scopes: Scope[] = [{ property: "Housing", conditions: [{ property: "Tags", value: "housing" }] }];
    const scoped = [
      file("1", { Housing: "Rent" }),
      file("2", { Tags: ["housing"] }),
      file("3", { Tags: ["car"] }),
    ];
    // A conditional property's files without a value sit loose unless the level says otherwise
    const top = treeFor(scoped, level("prop:Housing"), scopes).contents([]);
    expect(top.folders.map((f) => [f.label, f.count])).toEqual([["Rent", 1]]);
    expect(top.files.map((f) => f.file_id)).toEqual(["2", "3"]);
    // With its "No Housing" folder shown, it holds those it doesn't apply to as well
    const tree = treeFor(scoped, { ...level("prop:Housing"), noValue: "folder" }, scopes);
    expect(tree.contents([]).folders.map((f) => [f.label, f.count])).toEqual([["Rent", 1], ["No Housing", 2]]);
    expect(tree.contents([]).files).toEqual([]);
    expect(tree.filesAt([NO_VALUE]).map((f) => f.file_id)).toEqual(["2", "3"]);
  });

  it("makes one No folder for a property no file has", () => {
    const tree = treeFor(files, level("prop:Missing"));
    expect(tree.contents([]).folders.map((f) => [f.label, f.count])).toEqual([["No Missing", 4]]);
  });

  it("keys a date folder by its month", () => {
    const tree = treeFor([file("1", { Due: "2024-03-05" })], level("prop:Due"));
    expect(tree.contents([]).folders.map((f) => [f.value, f.label])).toEqual([["2024-03", "March 2024"]]);
  });

  it("shows just the files with no structure", () => {
    expect(treeFor(files, null).contents([])).toEqual({ level: null, folders: [], files });
  });
});

describe("empty folders and files without a value", () => {
  const extrasTree = (root: FolderLevel, extras: Parameters<typeof folderTree>[5]) => {
    const reader = valueReader({ typeOf, scopes: [], implied: impliedByFile(files, [], (p) => typeOf(p) === "array") });
    return folderTree(files, root, reader, typeOf, label, extras);
  };

  it("puts files with no value loose beside the folders when the level says so", () => {
    const tree = treeFor(files, { ...level("prop:Client"), noValue: "loose" });
    const top = tree.contents([]);
    expect(top.folders.map((f) => f.label)).toEqual(["Acme", "Globex"]);
    expect(top.files.map((f) => f.file_id)).toEqual(["4"]);
    expect(placeWithin(tree, [NO_VALUE])).toEqual([]);
  });

  it("shows every registered value when the level says so", () => {
    const tree = extrasTree({ ...level("prop:Client"), allValues: true }, { registered: () => ["Acme", "Initech"] });
    expect(tree.contents([]).folders.map((f) => [f.label, f.count])).toEqual([
      ["Acme", 2],
      ["Globex", 1],
      ["Initech", 0],
      ["No Client", 1],
    ]);
  });

  it("shows a New Folder folder only inside the folder it was made in", () => {
    const root = level("prop:Client", level("prop:Year"));
    const pins = [{ at: pinPlace(root, ["Acme"]), column: "prop:Year", value: "2030" }];
    const tree = extrasTree(root, { pins });
    expect(tree.contents(["Acme"]).folders.map((f) => [f.value, f.count])).toEqual([
      ["2023", 1],
      ["2024", 1],
      ["2030", 0],
    ]);
    expect(tree.contents(["Globex"]).folders.map((f) => f.value)).toEqual(["2024"]);
    // An empty folder is somewhere to be
    expect(placeWithin(tree, ["Acme", "2030"])).toEqual(["Acme", "2030"]);
    expect(tree.contents(["Acme", "2030"]).files).toEqual([]);
  });

  it("keeps a New Folder folder where it was made when a level is added below", () => {
    const root = level("prop:Client", level("prop:Year", level("prop:Project")));
    const pins = [{ at: [{ column: "prop:Client", value: "Acme" }], column: "prop:Year", value: "2030" }];
    expect(extrasTree(root, { pins }).contents(["Acme"]).folders.map((f) => f.value)).toContain("2030");
  });
});

describe("date folders", () => {
  const dated = [file("a", { Due: "2024-03-12" }), file("b", { Due: "2024-07-01" }), file("c", { Due: "2023-03-02" }), file("d", {})];

  it("files a date by the level's unit", () => {
    const by = (unit: FolderLevel["dateUnit"]) => treeFor(dated, { ...level("prop:Due"), dateUnit: unit }).contents([]).folders.map((f) => [f.label, f.count]);
    expect(by("year")).toEqual([["2023", 1], ["2024", 2], ["No Due", 1]]);
    expect(by("monthOfYear")).toEqual([["March", 2], ["July", 1], ["No Due", 1]]);
    expect(by("weekday")).toEqual([["Monday", 1], ["Tuesday", 1], ["Thursday", 1], ["No Due", 1]]);
  });

  it("nests a unit that repeats below the years", () => {
    const tree = treeFor(dated, { ...level("prop:Due"), dateUnit: "year", next: { ...level("prop:Due"), dateUnit: "monthOfYear" } });
    expect(tree.contents(["2024"]).folders.map((f) => f.label)).toEqual(["March", "July"]);
  });
});

describe("skipping single folders", () => {
  // Globex holds one year, 2024, which holds one file
  const tree = treeFor(files, level("prop:Client", level("prop:Year", level("prop:Project"))));

  it("opens on through folders that hold just one folder", () => {
    expect(skipSingles(tree, ["Globex"])).toEqual(["Globex", "2024", NO_VALUE]);
    // Acme holds two years: it stops there
    expect(skipSingles(tree, ["Acme"])).toEqual(["Acme"]);
  });

  it("skips only the folders whose level skips them", () => {
    // Globex's level (Client) doesn't skip; its year's (Year) does
    const yearOnly = (folder: string[]) => folder.length === 2;
    expect(skipSingles(tree, ["Globex"], yearOnly)).toEqual(["Globex"]);
    expect(skipSingles(tree, ["Globex", "2024"], yearOnly)).toEqual(["Globex", "2024", NO_VALUE]);
  });

  it("goes up past them, to where there's a choice", () => {
    expect(enclosingPlace(tree, ["Globex", "2024", NO_VALUE])).toEqual([]);
    expect(enclosingPlace(tree, ["Acme", "2024"])).toEqual(["Acme"]);
  });
});

describe("places", () => {
  const tree = treeFor(files, level("prop:Client", level("prop:Year")));

  it("keeps a place whose folders are all there", () => {
    const place = ["Acme", "2024"];
    expect(placeWithin(tree, place)).toBe(place);
    expect(placeWithin(tree, [])).toEqual([]);
  });

  it("cuts a place back to the deepest folder left", () => {
    expect(placeWithin(tree, ["Acme", "1999"])).toEqual(["Acme"]);
    expect(placeWithin(tree, ["Initech", "2024"])).toEqual([]);
    // Below the bottom level there are no folders
    expect(placeWithin(tree, ["Acme", "2024", "more"])).toEqual(["Acme", "2024"]);
  });

  it("names each step as its folder shows", () => {
    expect(placeSteps(tree, [NO_VALUE])).toEqual([{ value: NO_VALUE, label: "No Client", path: [NO_VALUE] }]);
    expect(placeSteps(tree, ["Acme", "2023"]).map((s) => [s.label, s.path])).toEqual([
      ["Acme", ["Acme"]],
      ["2023", ["Acme", "2023"]],
    ]);
  });

  it("finds every file under a place, at any depth", () => {
    expect(tree.filesAt(["Acme"]).map((f) => f.file_id)).toEqual(["1", "2"]);
    expect(tree.filesAt([]).length).toBe(files.length);
  });
});

describe("place filters", () => {
  const root = level("prop:Client", level("prop:Year"));
  const tree = treeFor(files, root);
  const reader = valueReader({ typeOf, scopes: [], implied: new Map() });

  it("makes a row per folder, with the folders at its level to move to", () => {
    const rows = placeFilters(tree, root, ["Acme", "2024"], reader.kindOf);
    expect(rows.map((r) => [r.column, r.value, r.path])).toEqual([
      ["Client", "Acme", ["Acme"]],
      ["Year", "2024", ["Acme", "2024"]],
    ]);
    expect(rows[0].options).toEqual([
      { value: "Acme", label: "Acme" },
      { value: "Globex", label: "Globex" },
      { value: NO_VALUE, label: "empty" },
    ]);
    expect(rows[1].options.map((o) => o.value)).toEqual(["2023", "2024"]);
  });

  it("gives each folder the conditions that pick out its files", () => {
    const now = new Date(2026, 9, 27, 15);
    // The date folders and the filters both read the clock: hold it at `now`
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const day = (back: number) => new Date(2026, 9, 27 - back, 12).toISOString();
    const mixed = [
      file("1", { Client: "Acme", Project: ["Apollo", "Hermes"], Year: 2024, Due: "2024-03-05", Note: "Hi" }),
      file("2", { Client: "Acme", Project: ["Apollo"], Year: 2023, Due: "2024-04-01", Note: "Hi" }),
      file("3", { Client: "Globex", Year: 2024, Due: "2024-02-29" }),
      file("4", {}, "a/b/4.pdf"),
    ].map((f, i) => ({ ...f, timestamp: day([0, 1, 5, 400][i]), file_size: [0, 20_000, 5_000_000, null][i] }));
    const read = valueReader({ typeOf, scopes: [], implied: new Map() });
    for (const column of ["prop:Client", "prop:Project", "prop:Year", "prop:Due", "prop:Note", "created", "size", "tags", "ext", "type"]) {
      const tree = treeFor(mixed, level(column));
      for (const folder of tree.contents([]).folders) {
        const conditions = folderConditions(column, folder.value, read.kindOf(column), now);
        expect(conditions.length, `${column} ${folder.label}`).toBeGreaterThan(0);
        const picked = applyFilters(mixed, conditions, "all", read.columnValue, read.kindOf);
        expect(picked.map((f) => f.file_id), `${column} ${folder.label}`).toEqual(tree.filesAt([folder.value]).map((f) => f.file_id));
      }
    }
    vi.useRealTimers();
  });

  it("lists the levels below a place", () => {
    expect(levelsBelow(root, []).map((l) => l.column)).toEqual(["prop:Client", "prop:Year"]);
    expect(levelsBelow(root, ["Acme"]).map((l) => l.column)).toEqual(["prop:Year"]);
    expect(levelsBelow(root, ["Acme", "2024"])).toEqual([]);
  });
});

describe("placeFilterRules", () => {
  const dated = [
    ...files,
    file("5", { Client: "Acme", Due: "2024-03-31", Project: ["Hermes"] }),
    file("6", { Client: "Acme", Due: "2024-04-01" }),
    file("7", { Client: "Acme", Due: "2024-03-01" }),
  ];
  const readerFor = (fs: FileRecord[]) => valueReader({ typeOf, scopes: [], implied: impliedByFile(fs, [], (p) => typeOf(p) === "array") });

  // The rules must pick exactly the folder's files, whatever the level's kind
  const cases: [string, FolderLevel, string[]][] = [
    ["a Select value", level("prop:Client", level("prop:Year")), ["Acme", "2024"]],
    ["a Multi-select value", level("prop:Project"), ["Hermes"]],
    ["the no-value folder", level("prop:Client"), [NO_VALUE]],
    ["a month", level("prop:Due"), ["2024-03"]],
  ];
  for (const [what, root, place] of cases) {
    it(`picks exactly the folder's files for ${what}`, () => {
      const reader = readerFor(dated);
      const tree = folderTree(dated, root, reader, typeOf, label);
      const rules = placeFilterRules(root, place, reader)!;
      expect(viewFiles(dated, rules, "all", reader).map((f) => f.file_id)).toEqual(tree.filesAt(place).map((f) => f.file_id));
    });
  }

  it("picks exactly a date folder of any unit that spans days, and none of one that repeats", () => {
    const reader = readerFor(dated);
    for (const [unit, value] of [["year", "2024"], ["quarter", "2024-Q1"], ["day", "2024-03-31"]] as const) {
      const root = { ...level("prop:Due"), dateUnit: unit };
      const tree = folderTree(dated, root, reader, typeOf, label);
      const rules = placeFilterRules(root, [value], reader)!;
      expect(viewFiles(dated, rules, "all", reader).map((f) => f.file_id)).toEqual(tree.filesAt([value]).map((f) => f.file_id));
    }
    expect(placeFilterRules({ ...level("prop:Due"), dateUnit: "monthOfYear" }, ["03"], reader)).toBeNull();
  });

  it("can't filter for Finder's relative date folders", () => {
    expect(placeFilterRules(level("created"), ["Today"], readerFor(files))).toBeNull();
  });
});

describe("folderGroups", () => {
  it("nests a group per folder below the place, with every file under each", () => {
    const tree = treeFor(files, level("prop:Client", level("prop:Year")));
    const groups = folderGroups(tree, [])!;
    expect(groups.map((g) => [g.label, g.count, g.depth])).toEqual([["Acme", 2, 0], ["Globex", 1, 0], ["No Client", 1, 0]]);
    expect(groups[0].children.map((g) => [g.label, g.rows.map((f) => f.file_id)])).toEqual([
      ["2023", ["2"]],
      ["2024", ["1"]],
    ]);
    expect(folderGroupPath(groups[0].children[1].id)).toEqual(["Acme", "2024"]);
  });

  it("starts at the place, and is null where only files are left", () => {
    const tree = treeFor(files, level("prop:Client", level("prop:Year")));
    expect(folderGroups(tree, ["Acme"])!.map((g) => g.label)).toEqual(["2023", "2024"]);
    expect(folderGroups(tree, ["Acme", "2024"])).toBeNull();
  });

  it("puts a multi-valued file in each of its folders", () => {
    const tree = treeFor(files, level("prop:Project"));
    const groups = folderGroups(tree, [])!;
    expect(groups.map((g) => [g.label, g.rows.map((f) => f.file_id)])).toEqual([
      ["Apollo", ["1", "2"]],
      ["Hermes", ["1"]],
      ["No Project", ["3", "4"]],
    ]);
  });

  it("only reads its own ids back as places", () => {
    expect(folderGroupPath("Client=Acme")).toBeNull();
  });
});

describe("viewFiles", () => {
  it("applies the view's filters", () => {
    const reader = valueReader({ typeOf, scopes: [], implied: new Map() });
    const rules = [{ id: "a", column: "prop:Client", op: "is" as const, value: "Acme" }];
    expect(viewFiles(files, rules, "all", reader).map((f) => f.file_id)).toEqual(["1", "2"]);
  });
});

describe("levelAt", () => {
  it("walks branches, then the usual next level", () => {
    const root = level("prop:Client", level("prop:Year"), { Acme: level("prop:Project") });
    expect(levelAt(root, [])?.column).toBe("prop:Client");
    expect(levelAt(root, ["Acme"])?.column).toBe("prop:Project");
    expect(levelAt(root, ["Globex"])?.column).toBe("prop:Year");
    expect(levelAt(root, ["Globex", "2024", "deeper"])).toBeNull();
  });
});

describe("seedFromGroups", () => {
  it("chains the grouping levels", () => {
    expect(
      seedFromGroups([
        { key: "prop:Client", direction: "asc" },
        { key: "created", direction: "desc" },
      ])
    ).toEqual(level("prop:Client", { ...level("created"), direction: "desc" }));
    expect(seedFromGroups([])).toBeNull();
  });
});
