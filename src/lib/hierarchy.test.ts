import { describe, expect, it } from "vitest";
import {
  chainAt,
  chainFiles,
  forkAt,
  insertLevel,
  levelExamples,
  moveIntoFork,
  moveLevel,
  removeFork,
  removeLevel,
  scopeSuggestion,
  setDirection,
  setLevel,
  setSkipSingleEverywhere,
  setEveryLevel,
  settingAcross,
  skipsSingleEverywhere,
  slotAt,
  tidyFolders,
} from "./hierarchy";
import { NO_VALUE } from "./folderTree";
import { impliedByFile, valueReader } from "./fileValues";
import type { FolderLevel } from "./tableViews";
import type { FileRecord, ValueType } from "../types";

const file = (id: string, metadata: Record<string, unknown>): FileRecord => ({
  file_id: id,
  location_id: "loc",
  file_path: `/x/${id}.pdf`,
  relative_path: `${id}.pdf`,
  file_type: "application/pdf",
  file_size: 1,
  timestamp: "2024-01-01T00:00:00Z",
  modified_at: null,
  metadata,
  tags: [],
} as unknown as FileRecord);

const TYPES: Record<string, ValueType> = { Person: "enum", Tags: "array", Year: "number", Housing: "enum" };
const typeOf = (name: string): ValueType => TYPES[name] ?? "free_text";
const files = [
  file("1", { Person: "Josh", Tags: ["housing", "tax"], Year: 2024, Housing: "Rent" }),
  file("2", { Person: "Josh", Tags: ["tax"], Year: 2023 }),
  file("3", { Person: "Mia", Tags: ["housing"], Year: 2024, Housing: "Council Tax" }),
  file("4", {}),
];
const reader = valueReader({ typeOf, scopes: [], implied: impliedByFile(files, [], (p) => typeOf(p) === "array") });

/** A chain's columns, forks shown as {value: [...]} after their level. */
function shape(root: FolderLevel | null): unknown[] {
  const out: unknown[] = [];
  for (let l = root; l; l = l.next) {
    out.push(l.column.replace("prop:", ""));
    const forks = Object.entries(l.branches);
    if (forks.length > 0) out.push(Object.fromEntries(forks.map(([v, f]) => [v, shape(f)])));
  }
  return out;
}

const top = (index: number) => ({ chain: [], index });
let root: FolderLevel | null = null;
root = insertLevel(root, top(0), "prop:Person", "asc");
root = insertLevel(root, top(1), "prop:Tags", "asc");
root = insertLevel(root, top(2), "prop:Year", "desc");

describe("editing the hierarchy", () => {
  it("inserts, removes and reorders levels in the top chain", () => {
    expect(shape(root)).toEqual(["Person", "Tags", "Year"]);
    expect(shape(removeLevel(root, top(1)))).toEqual(["Person", "Year"]);
    expect(shape(moveLevel(root, top(2), top(0)))).toEqual(["Year", "Person", "Tags"]);
    expect(shape(moveLevel(root, top(0), top(3)))).toEqual(["Tags", "Year", "Person"]);
    expect(setDirection(root, top(0), "desc")!.direction).toBe("desc");
  });

  it("changes a level's settings, leaving out those turned off", () => {
    const loose = setLevel(root, top(0), { noValue: "loose", allValues: true });
    expect([loose!.noValue, loose!.allValues]).toEqual(["loose", true]);
    const back = setLevel(loose, top(0), { noValue: undefined, allValues: undefined });
    expect("noValue" in back! || "allValues" in back!).toBe(false);
  });

  it("forks inside one folder, then carries on as usual", () => {
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    expect(shape(forked)).toEqual(["Person", "Tags", { housing: ["Housing", "Year"] }, "Year"]);
    expect(chainAt(forked, [{ index: 1, value: "housing" }]).map((l) => l.column)).toEqual(["prop:Housing", "prop:Year"]);
  });

  it("keeps a fork carrying on as usual when what follows changes", () => {
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    expect(shape(insertLevel(forked, top(3), "type", "asc"))).toEqual(["Person", "Tags", { housing: ["Housing", "Year", "type"] }, "Year", "type"]);
    expect(shape(removeLevel(forked, top(2)))).toEqual(["Person", "Tags", { housing: ["Housing"] }]);
  });

  it("removes a fork, and tidies one that no longer differs", () => {
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    expect(shape(removeFork(forked, top(1), "housing"))).toEqual(["Person", "Tags", "Year"]);
    // Taking the fork's own level out leaves it the same as usual: it goes
    expect(shape(removeLevel(forked, { chain: [{ index: 1, value: "housing" }], index: 0 }))).toEqual(["Person", "Tags", "Year"]);
  });

  it("moves a level with its forks, which carry on as usual where it lands", () => {
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    expect(shape(moveLevel(forked, top(1), top(0)))).toEqual(["Tags", { housing: ["Housing", "Person", "Year"] }, "Person", "Year"]);
  });

  it("moves a level into and out of a fork", () => {
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    const inFork = { chain: [{ index: 1, value: "housing" }], index: 0 };
    expect(shape(moveLevel(forked, top(0), inFork))).toEqual(["Tags", { housing: ["Person", "Housing", "Year"] }, "Year"]);
    expect(shape(moveLevel(forked, inFork, top(0)))).toEqual(["Housing", "Person", "Tags", "Year"]);
  });

  it("moves a level onto a folder, into a fork there", () => {
    // Year, dropped on Tags' "housing": only that folder gets Year first
    expect(shape(moveIntoFork(root, top(2), top(1), "housing"))).toEqual(["Person", "Tags", { housing: ["Year"] }]);
    // Person, dropped on Tags' "housing" (Person ran before Tags)
    expect(shape(moveIntoFork(root, top(0), top(1), "housing"))).toEqual(["Tags", { housing: ["Person", "Year"] }, "Year"]);
    // A level already in that fork moves to its front
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    expect(shape(moveIntoFork(forked, { chain: [{ index: 1, value: "housing" }], index: 1 }, top(1), "housing"))).toEqual([
      "Person",
      "Tags",
      { housing: ["Year", "Housing"] },
      "Year",
    ]);
  });

  it("won't move a level onto its own folders", () => {
    expect(moveIntoFork(root, top(1), top(1), "housing")).toBe(root);
  });

  it("won't move a level into its own fork", () => {
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    expect(moveLevel(forked, top(1), { chain: [{ index: 1, value: "housing" }], index: 0 })).toBe(forked);
  });

  it("tidies nothing away when every fork differs", () => {
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    expect(shape(tidyFolders(forked))).toEqual(shape(forked));
  });
});

describe("skipping single folders everywhere", () => {
  it("turns it on and off for every level, branches' too", () => {
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    const on = setSkipSingleEverywhere(forked, true);
    expect(skipsSingleEverywhere(on)).toBe(true);
    expect(chainAt(on, [{ index: 1, value: "housing" }]).every((l) => l.skipSingle)).toBe(true);
    // One level without it: not everywhere
    expect(skipsSingleEverywhere(setLevel(on, top(2), { skipSingle: undefined }))).toBe(false);
    expect(skipsSingleEverywhere(setSkipSingleEverywhere(on, false))).toBe(false);
    expect(skipsSingleEverywhere(null)).toBe(false);
  });

  it("reads and sets a setting across every level, branches' too", () => {
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    const all = () => true;
    const skips = (l: FolderLevel) => !!l.skipSingle;
    expect(settingAcross(forked, all, skips)).toBe("off");
    // Just the level inside a branch: mixed
    const inside = setLevel(forked, { chain: [{ index: 1, value: "housing" }], index: 0 }, { skipSingle: true });
    expect(settingAcross(inside, all, skips)).toBe("mixed");
    const on = setEveryLevel(inside, () => ({ skipSingle: true }));
    expect(settingAcross(on, all, skips)).toBe("on");
    expect(shape(on)).toEqual(shape(forked));
    // Turned off, the setting is left out rather than kept as false
    expect(Object.keys(setEveryLevel(on, () => ({ skipSingle: undefined }))!)).not.toContain("skipSingle");
    // Only the levels it applies to: here just Person
    const person = (l: FolderLevel) => l.column === "prop:Person";
    const onlyPerson = setEveryLevel(forked, (l) => (person(l) ? { allValues: true } : null));
    expect(settingAcross(onlyPerson, person, (l) => !!l.allValues)).toBe("on");
    expect(settingAcross(onlyPerson, all, (l) => !!l.allValues)).toBe("mixed");
    expect(settingAcross(null, all, skips)).toBeNull();
  });
});

describe("slotAt", () => {
  it("finds the level inside a folder, through its fork if it has one", () => {
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    expect(slotAt(forked, [])).toEqual(top(0));
    expect(slotAt(forked, ["Josh", "tax"])).toEqual(top(2));
    expect(slotAt(forked, ["Josh", "housing"])).toEqual({ chain: [{ index: 1, value: "housing" }], index: 0 });
    expect(slotAt(forked, ["Josh", "housing", "Rent"])).toEqual({ chain: [{ index: 1, value: "housing" }], index: 1 });
    expect(slotAt(forked, ["Josh", "tax", "2024"])).toBeNull();
  });
});

describe("examples", () => {
  it("counts each folder a column makes, in the level's order, with No X last", () => {
    const ex = levelExamples(files, { column: "prop:Tags", direction: "asc" }, reader, typeOf, "No Tags", 2);
    expect(ex.values).toEqual([
      { value: "housing", label: "housing", count: 2 },
      { value: "tax", label: "tax", count: 2 },
    ]);
    expect(ex.more).toBe(1);
    const years = levelExamples(files, { column: "prop:Year", direction: "desc" }, reader, typeOf, "No Year");
    expect(years.values.map((v) => v.label)).toEqual(["2024", "2023", "No Year"]);
    expect(years.values[2].value).toBe(NO_VALUE);
  });

  it("leaves out the No X folder where files without a value sit loose", () => {
    const ex = levelExamples(files, { column: "prop:Year", direction: "desc", noValue: "loose" }, reader, typeOf, "No Year");
    expect(ex.values.map((v) => v.label)).toEqual(["2024", "2023"]);
  });

  it("gives a fork's chain only the files in its folder", () => {
    const forked = forkAt(root, top(1), "housing", "prop:Housing", "asc");
    const inside = chainFiles(files, forked, [{ index: 1, value: "housing" }], reader, typeOf);
    expect(inside.map((f) => f.file_id)).toEqual(["1", "3"]);
  });
});

describe("scopeSuggestion", () => {
  const scope = { property: "Housing", conditions: [{ property: "Tags", value: "housing" }] };

  it("suggests the condition's folder when its property is a level", () => {
    expect(scopeSuggestion(root, scope)).toEqual({ slot: top(1), value: "housing" });
  });

  it("suggests nothing once it's there, or when its condition isn't a level", () => {
    expect(scopeSuggestion(forkAt(root, top(1), "housing", "prop:Housing", "asc"), scope)).toBeNull();
    expect(scopeSuggestion(removeLevel(root, top(1)), scope)).toBeNull();
  });
});
