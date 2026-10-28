import { describe, expect, it } from "vitest";
import { columnGroup, groupByColumn } from "./propertyGroups";

describe("property groups", () => {
  it("tells the library's, the file's and the media's apart", () => {
    expect(columnGroup("prop:Client")).toBe("custom");
    expect(columnGroup("prop:camera_make")).toBe("media");
    expect(columnGroup("created")).toBe("native");
    expect(columnGroup("tags")).toBe("native");
    expect(columnGroup("iso", true)).toBe("media");
    expect(columnGroup("Client", true)).toBe("custom");
  });

  it("orders them custom, native, media, leaving out empty groups", () => {
    const ids = ["name", "prop:iso", "prop:Client", "size", "prop:Year"];
    expect(groupByColumn(ids, (id) => id).map((g) => [g.label, g.items])).toEqual([
      ["Custom", ["prop:Client", "prop:Year"]],
      ["Native", ["name", "size"]],
      ["Media", ["prop:iso"]],
    ]);
    expect(groupByColumn(["name"], (id) => id).map((g) => g.label)).toEqual(["Native"]);
  });
});
