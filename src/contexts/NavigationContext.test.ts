import { describe, it, expect } from "vitest";
import { navigationReducer } from "./NavigationContext";

const base = {
  activeLocationId: null,
  activeViewId: null,
  path: [],
  viewMode: "tiles" as const,
  views: [],
  viewNodes: [],
  editStructure: false,
  masterEditorOpen: false,
  structureLocationId: null,
};

describe("navigationReducer", () => {
  it("pushSegment appends to path", () => {
    const s = navigationReducer({ ...base, path: ["a"] }, { type: "PUSH_SEGMENT", segment: "b" });
    expect(s.path).toEqual(["a", "b"]);
  });

  it("popToIndex trims path to given length", () => {
    const s = navigationReducer({ ...base, path: ["a", "b", "c"] }, { type: "POP_TO_INDEX", index: 1 });
    expect(s.path).toEqual(["a"]);
  });

  it("popToIndex(0) clears path", () => {
    const s = navigationReducer({ ...base, path: ["a", "b"] }, { type: "POP_TO_INDEX", index: 0 });
    expect(s.path).toEqual([]);
  });

  it("setActiveView resets path to []", () => {
    const s = navigationReducer({ ...base, activeViewId: "old", path: ["x"] }, { type: "SET_VIEW", viewId: "new" });
    expect(s.activeViewId).toBe("new");
    expect(s.path).toEqual([]);
  });

  it("openStructureMapping switches to the location and opens the panel", () => {
    const s = navigationReducer(
      { ...base, activeLocationId: "a", activeViewId: "v", path: ["x"] },
      { type: "OPEN_STRUCTURE", locationId: "b" }
    );
    expect(s.activeLocationId).toBe("b");
    expect(s.activeViewId).toBeNull();
    expect(s.path).toEqual([]);
    expect(s.structureLocationId).toBe("b");
  });

  it("openStructureMapping on the active location keeps the path", () => {
    const s = navigationReducer(
      { ...base, activeLocationId: "a", path: ["x"] },
      { type: "OPEN_STRUCTURE", locationId: "a" }
    );
    expect(s.path).toEqual(["x"]);
    expect(s.structureLocationId).toBe("a");
  });

  it("switching location closes Map Structure", () => {
    const s = navigationReducer(
      { ...base, activeLocationId: "a", structureLocationId: "a" },
      { type: "SET_LOCATION", locationId: "b" }
    );
    expect(s.structureLocationId).toBeNull();
  });
});
