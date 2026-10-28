import { describe, it, expect } from "vitest";
import { navigationReducer } from "./NavigationContext";

const base = {
  activeLocationId: null,
  activeViewId: null,
  path: [],
  viewMode: "tiles" as const,
  views: [],
  viewNodes: [],
  editHierarchy: false,
  masterEditorOpen: false,
  diskFoldersLocationId: null,
  rulesOpen: false,
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

  it("openDiskFolders switches to the location and opens the panel", () => {
    const s = navigationReducer(
      { ...base, activeLocationId: "a", activeViewId: "v", path: ["x"] },
      { type: "OPEN_DISK_FOLDERS", locationId: "b" }
    );
    expect(s.activeLocationId).toBe("b");
    expect(s.activeViewId).toBeNull();
    expect(s.path).toEqual([]);
    expect(s.diskFoldersLocationId).toBe("b");
  });

  it("openDiskFolders on the active location keeps the path", () => {
    const s = navigationReducer(
      { ...base, activeLocationId: "a", path: ["x"] },
      { type: "OPEN_DISK_FOLDERS", locationId: "a" }
    );
    expect(s.path).toEqual(["x"]);
    expect(s.diskFoldersLocationId).toBe("a");
  });

  it("switching location closes Map Disk Folders", () => {
    const s = navigationReducer(
      { ...base, activeLocationId: "a", diskFoldersLocationId: "a" },
      { type: "SET_LOCATION", locationId: "b" }
    );
    expect(s.diskFoldersLocationId).toBeNull();
  });

  it("opening one side panel closes the others", () => {
    const hierarchy = navigationReducer(
      { ...base, activeLocationId: "a", diskFoldersLocationId: "a", rulesOpen: true },
      { type: "SET_EDIT_HIERARCHY", value: true }
    );
    expect(hierarchy).toMatchObject({ editHierarchy: true, diskFoldersLocationId: null, rulesOpen: false });

    const disk = navigationReducer({ ...hierarchy }, { type: "OPEN_DISK_FOLDERS", locationId: "a" });
    expect(disk).toMatchObject({ editHierarchy: false, diskFoldersLocationId: "a", rulesOpen: false });

    const rules = navigationReducer({ ...disk }, { type: "SET_RULES_OPEN", open: true });
    expect(rules).toMatchObject({ editHierarchy: false, diskFoldersLocationId: null, rulesOpen: true });
  });

  it("closing a side panel leaves the others as they are", () => {
    const s = navigationReducer({ ...base, diskFoldersLocationId: "a" }, { type: "SET_EDIT_HIERARCHY", value: false });
    expect(s.diskFoldersLocationId).toBe("a");
  });

  it("Rules closes on leaving the Database view or the location", () => {
    const open = { ...base, viewMode: "database" as const, rulesOpen: true };
    expect(navigationReducer(open, { type: "SET_VIEW_MODE", mode: "list" }).rulesOpen).toBe(false);
    expect(navigationReducer(open, { type: "SET_VIEW_MODE", mode: "database" }).rulesOpen).toBe(true);
    expect(navigationReducer(open, { type: "SET_LOCATION", locationId: "b" }).rulesOpen).toBe(false);
  });
});
