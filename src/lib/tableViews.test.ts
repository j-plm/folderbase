import { describe, expect, it } from "vitest";
import {
  emptyFolders,
  emptyTable,
  legacyTable,
  parseViewDefinition,
  sameViewDefinition,
  serializeViewDefinition,
  uniqueViewName,
  workingDefinition,
  type StoredView,
} from "./tableViews";

describe("parseViewDefinition", () => {
  it("round-trips a definition", () => {
    const def = {
      table: {
        ...emptyTable(),
        filters: [{ id: "a", column: "prop:Client", op: "is" as const, value: "Acme" }],
        match: "any" as const,
        groups: [{ key: "prop:Client", direction: "asc" as const }],
        visibleProperties: ["Client"],
        frozen: false,
      },
      folders: emptyFolders(),
    };
    expect(parseViewDefinition(serializeViewDefinition(def))).toEqual(def);
  });

  it("keeps the item a list filter looks at", () => {
    const filters = [{ id: "a", column: "tags", op: "matches" as const, value: "{Year:4}", item: "n:2" }];
    const def = parseViewDefinition(serializeViewDefinition({ table: { ...emptyTable(), filters } }));
    expect(def.table.filters).toEqual(filters);
    // Groups of filters keep their own And/Or
    const grouped = [filters[0], { id: "g", match: "any" as const, items: [{ id: "b", column: "ext", op: "has" as const, value: "pdf" }] }];
    expect(parseViewDefinition(serializeViewDefinition({ table: { ...emptyTable(), filters: grouped } })).table.filters).toEqual(grouped);
  });

  it("round-trips a hierarchy with branches", () => {
    const folders = {
      root: {
        column: "prop:Client",
        direction: "asc" as const,
        next: { column: "prop:Project", direction: "desc" as const, next: null, branches: {}, allValues: true as const },
        branches: { Acme: { column: "created", direction: "asc" as const, next: null, branches: {} }, Globex: null },
        noValue: "loose" as const,
      },
      pins: [{ at: [{ column: "prop:Client", value: "Acme" }], column: "prop:Project", value: "Pension" }],
    };
    const def = { table: emptyTable(), folders };
    expect(parseViewDefinition(serializeViewDefinition(def))).toEqual(def);
  });

  it("reads a missing or malformed hierarchy as no folders", () => {
    expect(parseViewDefinition(JSON.stringify({ table: {} })).folders).toEqual(emptyFolders());
    expect(parseViewDefinition(JSON.stringify({ folders: { root: { direction: "asc" } } })).folders).toEqual(emptyFolders());
    const nested = parseViewDefinition(JSON.stringify({ folders: { root: { column: "type", next: 4, branches: [] } } }));
    expect(nested.folders).toEqual({ root: { column: "type", direction: "asc", next: null, branches: {} }, pins: [] });
    // Malformed pins are dropped, good ones kept
    const pins = parseViewDefinition(JSON.stringify({ folders: { root: null, pins: [{ at: [], column: "prop:A", value: "x" }, { at: 3 }] } }));
    expect(pins.folders?.pins).toEqual([{ at: [], column: "prop:A", value: "x" }]);
  });

  it("fills missing and malformed fields from the defaults", () => {
    const def = parseViewDefinition(JSON.stringify({ table: { showTags: true, visibleProperties: "Client", match: "some" } }));
    expect(def.table).toEqual({ ...emptyTable(), showTags: true });
  });

  it("shows non-empty columns unless turned off, and groups by folders only once turned on", () => {
    const old = parseViewDefinition(JSON.stringify({ table: { frozen: false } }));
    expect(old.table.nonEmptyColumns).toBe(true);
    expect(old.table.folderGroups).toBe(false);
    const changed = { table: { ...emptyTable(), nonEmptyColumns: false, folderGroups: true } };
    const back = parseViewDefinition(serializeViewDefinition(changed));
    expect([back.table.nonEmptyColumns, back.table.folderGroups]).toEqual([false, true]);
  });

  it("treats broken or absent JSON as an empty view", () => {
    expect(parseViewDefinition("{nope").table).toEqual(emptyTable());
    expect(parseViewDefinition(null).table).toEqual(emptyTable());
    expect(parseViewDefinition(JSON.stringify({ folders: [] })).table).toEqual(emptyTable());
  });
});

describe("sameViewDefinition", () => {
  it("ignores key order and extra fields", () => {
    const a = { table: emptyTable() };
    const b = { table: { ...emptyTable(), sorts: [{ direction: "asc" as const, key: "path", extra: 1 } as never] } };
    expect(sameViewDefinition(a, b)).toBe(true);
  });

  it("treats a left-out hierarchy as none, and branch order as irrelevant", () => {
    expect(sameViewDefinition({ table: emptyTable() }, { table: emptyTable(), folders: emptyFolders() })).toBe(true);
    const level = (branches: Record<string, null>) => ({ root: { column: "type", direction: "asc" as const, next: null, branches } });
    expect(
      sameViewDefinition({ table: emptyTable(), folders: level({ a: null, b: null }) }, { table: emptyTable(), folders: level({ b: null, a: null }) })
    ).toBe(true);
    expect(sameViewDefinition({ table: emptyTable() }, { table: emptyTable(), folders: level({}) })).toBe(false);
  });

  it("notices a changed filter, sort or column", () => {
    const a = { table: emptyTable() };
    expect(sameViewDefinition(a, { table: { ...emptyTable(), sorts: [] } })).toBe(false);
    expect(sameViewDefinition(a, { table: { ...emptyTable(), showTags: true } })).toBe(false);
  });
});

describe("workingDefinition", () => {
  const view: StoredView = {
    view_id: "v",
    location_id: "l",
    name: "By Client",
    is_default: false,
    position: 0,
    definition: serializeViewDefinition({ table: emptyTable() }),
    draft: null,
  };

  it("prefers unsaved edits over what was saved", () => {
    expect(workingDefinition(view).table.showTags).toBe(false);
    const draft = serializeViewDefinition({ table: { ...emptyTable(), showTags: true } });
    expect(workingDefinition({ ...view, draft }).table.showTags).toBe(true);
  });
});

describe("legacyTable", () => {
  it("starts from the column settings kept before views", () => {
    const stored: Record<string, unknown> = { "col-props": ["Client"], "col-freeze": false, "col-hidden": "bad" };
    const t = legacyTable((k) => stored[k]);
    expect(t).toEqual({ ...emptyTable(), visibleProperties: ["Client"], frozen: false });
  });
});

describe("uniqueViewName", () => {
  it("numbers a name that's taken, ignoring case", () => {
    expect(uniqueViewName("By Client", [])).toBe("By Client");
    expect(uniqueViewName("By Client", ["by client"])).toBe("By Client 2");
    expect(uniqueViewName("By Client", ["By Client", "By Client 2"])).toBe("By Client 3");
  });
});
