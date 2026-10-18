import { describe, expect, it } from "vitest";
import {
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
    };
    expect(parseViewDefinition(serializeViewDefinition(def))).toEqual(def);
  });

  it("fills missing and malformed fields from the defaults", () => {
    const def = parseViewDefinition(JSON.stringify({ table: { showTags: true, visibleProperties: "Client", match: "some" } }));
    expect(def.table).toEqual({ ...emptyTable(), showTags: true });
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
