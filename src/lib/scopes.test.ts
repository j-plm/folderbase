import { describe, it, expect } from "vitest";
import {
  applies,
  dependsOn,
  describeScope,
  impliedValues,
  opensInto,
  propertiesToClear,
  scopeCoverage,
  scopeOrigin,
  scopeState,
  scopesByName,
  type Scope,
} from "./scopes";

// Housing applies when Tags has housing; Insurance Type when Housing is House Insurance;
// Cover when Tags has housing or car (two conditions)
const scopes: Scope[] = [
  { property: "Housing", conditions: [{ property: "Tags", value: "housing" }] },
  { property: "Insurance Type", conditions: [{ property: "Housing", value: "House Insurance" }] },
  {
    property: "Cover",
    conditions: [
      { property: "Tags", value: "housing" },
      { property: "Tags", value: "car" },
    ],
  },
];
const lists = new Set(["Tags", "Cover"]);
const isList = (p: string) => lists.has(p);

describe("scopesByName", () => {
  it("groups the registry's rows by property name, dropping unknown properties", () => {
    const names: Record<string, string> = { t: "Tags", h: "Housing" };
    const result = scopesByName(
      [
        { property_id: "h", condition_property_id: "t", value: "housing" },
        { property_id: "h", condition_property_id: "t", value: "home" },
        { property_id: "x", condition_property_id: "t", value: "gone" },
      ],
      (id) => names[id]
    );
    expect(result).toEqual([
      { property: "Housing", conditions: [{ property: "Tags", value: "housing" }, { property: "Tags", value: "home" }] },
    ]);
  });
});

describe("impliedValues", () => {
  it("a value implies its tag", () => {
    expect(impliedValues({ Housing: "Rent" }, scopes, isList)).toEqual({ Tags: ["housing"] });
  });

  it("follows a chain of scopes", () => {
    expect(impliedValues({ "Insurance Type": "Buildings" }, scopes, isList)).toEqual({
      Housing: ["House Insurance"],
      Tags: ["housing"],
    });
  });

  it("adds nothing already held, in any case", () => {
    expect(impliedValues({ Housing: "Rent", Tags: ["Housing"] }, scopes, isList)).toEqual({});
  });

  it("implies nothing from a scope with several conditions", () => {
    expect(impliedValues({ Cover: ["Full"] }, scopes, isList)).toEqual({});
  });

  it("doesn't overwrite a single-value property holding something else", () => {
    expect(impliedValues({ "Insurance Type": "Buildings", Housing: "Rent" }, scopes, isList)).toEqual({ Tags: ["housing"] });
  });
});

describe("applies and scopeState", () => {
  it("applies when any condition holds, stored or implied", () => {
    expect(applies(scopes[2], { Tags: ["car"] }, {})).toBe(true);
    expect(applies(scopes[0], {}, { Tags: ["housing"] })).toBe(true);
    expect(applies(scopes[0], { Tags: ["travel"] }, {})).toBe(false);
    expect(applies(undefined, {}, {})).toBe(true);
  });

  it("tells a value, an expected value and doesn't-apply apart", () => {
    expect(scopeState(scopes[0], { Housing: "Rent" }, {})).toBe("value");
    expect(scopeState(scopes[0], { Tags: ["housing"] }, {})).toBe("expected");
    expect(scopeState(scopes[0], { Tags: ["travel"] }, {})).toBe("na");
    expect(scopeState(undefined, {}, {})).toBe("value");
  });
});

describe("propertiesToClear", () => {
  it("clears a property whose only condition goes, then those scoped to it", () => {
    const meta = { Tags: ["housing"], Housing: "House Insurance", "Insurance Type": "Buildings" };
    expect(propertiesToClear(meta, scopes, "Tags", ["housing"])).toEqual(["Housing", "Insurance Type"]);
  });

  it("keeps a property another condition still supports", () => {
    expect(propertiesToClear({ Tags: ["housing", "car"], Cover: ["Full"] }, scopes, "Tags", ["housing"])).toEqual([]);
  });

  it("ignores empty properties and unrelated values", () => {
    expect(propertiesToClear({ Tags: ["housing"] }, scopes, "Tags", ["housing"])).toEqual([]);
    expect(propertiesToClear({ Tags: ["housing", "tax"], Housing: "Rent" }, scopes, "Tags", ["tax"])).toEqual([]);
  });
});

describe("labels", () => {
  it("names what a value opens into", () => {
    expect(opensInto(scopes, "Tags", "housing")).toEqual(["Housing", "Cover"]);
    expect(opensInto(scopes, "Housing", "housing")).toEqual([]);
    expect(opensInto(scopes, null, "House Insurance")).toEqual(["Insurance Type"]);
  });

  it("describes a header's origin and condition", () => {
    expect(scopeOrigin(scopes[0], "Tags")).toBe("Tags"); // Housing ‹ housing repeats the name
    expect(scopeOrigin({ property: "Housing", conditions: [{ property: "Tags", value: "home" }] }, "Tags")).toBe("home");
    expect(scopeOrigin(scopes[1], "Tags")).toBe("Housing: House Insurance");
    expect(scopeOrigin(scopes[2], "Tags")).toBe("housing, car");
    expect(scopeOrigin(undefined)).toBeNull();
    expect(describeScope(scopes[2])).toBe("Applies when Tags has housing or car");
  });
});

describe("dependsOn", () => {
  it("follows chains, and not the other way", () => {
    expect(dependsOn(scopes, "Insurance Type", "Tags")).toBe(true);
    expect(dependsOn(scopes, "Housing", "Tags")).toBe(true);
    expect(dependsOn(scopes, "Tags", "Housing")).toBe(false);
    expect(dependsOn(scopes, "Cover", "Housing")).toBe(false);
  });
});

describe("scopeCoverage", () => {
  const metas = [
    { Tags: ["housing"], Housing: "Rent" },
    { Tags: ["housing"] },
    { Client: "Acme" },
    { Tags: ["travel"] },
  ];

  it("counts files with a value, still to fill in, and not applying", () => {
    expect(scopeCoverage(metas, scopes, "Housing", [{ property: "Tags", value: "housing" }], isList)).toEqual({
      withValue: 1,
      expected: 1,
      na: 2,
    });
  });

  it("with no conditions, every empty file is still to fill in", () => {
    expect(scopeCoverage(metas, scopes, "Housing", [], isList)).toEqual({ withValue: 1, expected: 3, na: 0 });
  });
});
