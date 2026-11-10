import { describe, it, expect } from "vitest";
import {
  ANY_VALUE,
  applies,
  describeCondition,
  impliedConditions,
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
        { property_id: "h", condition_property_id: "t", value: "housing", match_all: false },
        { property_id: "h", condition_property_id: "t", value: "home", match_all: false },
        { property_id: "x", condition_property_id: "t", value: "gone", match_all: false },
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

describe("a condition on any value", () => {
  // Scan_Side applies when Component has any value (a Text property)
  const any: Scope = { property: "Scan_Side", conditions: [{ property: "Component", value: ANY_VALUE }] };

  it("applies while the property has a value, whatever it is", () => {
    expect(applies(any, { Component: "Sprocket" }, {})).toBe(true);
    expect(applies(any, { Component: "" }, {})).toBe(false);
    expect(scopeState(any, {}, {})).toBe("na");
    expect(scopeState(any, { Component: "Hub" }, {})).toBe("expected");
  });

  it("implies nothing, as it names no value", () => {
    expect(impliedValues({ Scan_Side: "S1" }, [any], () => false)).toEqual({});
  });

  it("is cleared only when the property's last value goes", () => {
    const both = [{ ...any, conditions: [{ property: "Tags", value: ANY_VALUE }] }];
    expect(propertiesToClear({ Tags: ["a", "b"], Scan_Side: "S1" }, both, "Tags", ["a"])).toEqual([]);
    expect(propertiesToClear({ Tags: ["a", "b"], Scan_Side: "S1" }, both, "Tags", ["a", "b"])).toEqual(["Scan_Side"]);
  });

  it("opens from every value of its property, and reads as having a value", () => {
    expect(opensInto([any], "Component", "Sprocket")).toEqual(["Scan_Side"]);
    expect(opensInto([any], null, "Sprocket")).toEqual([]);
    expect(scopeOrigin(any)).toBe("Component");
    expect(describeScope(any)).toBe("Applies when Component has a value");
    expect(describeCondition(any.conditions[0])).toBe("Component has a value");
    expect(describeCondition({ property: "Tags", value: "car" })).toBe("Tags has “car”");
  });
});

describe("conditions that must all hold", () => {
  // Scan_Side applies to Sprocket Scans files that have a Component
  const both: Scope = {
    property: "Scan_Side",
    all: true,
    conditions: [
      { property: "Measurement Type", value: "Sprocket Scans" },
      { property: "Component", value: ANY_VALUE },
    ],
  };

  it("reads all from the registry's rows", () => {
    const names: Record<string, string> = { s: "Scan_Side", m: "Measurement Type" };
    const [scope] = scopesByName([{ property_id: "s", condition_property_id: "m", value: "Sprocket Scans", match_all: true }], (id) => names[id]);
    expect(scope.all).toBe(true);
  });

  it("applies only where every condition holds", () => {
    expect(applies(both, { "Measurement Type": "Sprocket Scans", Component: "Hub" }, {})).toBe(true);
    expect(applies(both, { "Measurement Type": "Sprocket Scans" }, {})).toBe(false);
    expect(applies(both, { Component: "Hub" }, {})).toBe(false);
  });

  it("implies each named value, even with several conditions", () => {
    expect(impliedConditions(both)).toEqual([{ property: "Measurement Type", value: "Sprocket Scans" }]);
    expect(impliedValues({ Scan_Side: "S1" }, [both], () => false)).toEqual({ "Measurement Type": ["Sprocket Scans"] });
  });

  it("is cleared when any one condition stops holding", () => {
    const meta = { "Measurement Type": "Sprocket Scans", Component: ["Hub"], Scan_Side: "S1" };
    expect(propertiesToClear(meta, [both], "Component", ["Hub"])).toEqual(["Scan_Side"]);
  });

  it("reads as and", () => {
    expect(describeScope(both)).toBe("Applies when Measurement Type has Sprocket Scans, and Component has a value");
    expect(scopeOrigin(both)).toBe("Measurement Type: Sprocket Scans + Component");
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
