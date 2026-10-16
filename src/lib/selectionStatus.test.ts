import { describe, expect, it } from "vitest";
import { selectionLabel } from "./selectionStatus";

describe("selectionLabel", () => {
  it("shows only when several files are selected", () => {
    expect(selectionLabel({ selected: 0, total: 10 })).toBeNull();
    expect(selectionLabel({ selected: 1, total: 10 })).toBeNull();
    expect(selectionLabel({ selected: 3, total: 1204 })).toBe(`3 of ${(1204).toLocaleString()} selected`);
  });
});
