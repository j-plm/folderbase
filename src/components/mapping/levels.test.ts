import { describe, expect, it } from "vitest";
import type { FolderTreeNode } from "../../lib/commands";
import {
  clickSelection,
  levelCaption,
  levelCoverage,
  levelExtension,
  levelNodes,
  levelTargets,
  rebuildLevels,
  selectAllInLevel,
  type Level,
} from "./levels";

const node = (path: string): FolderTreeNode => ({
  folder_path: path,
  folder_name: path.split("/").pop() ?? path,
  depth: 1,
  file_count: 1,
  children: [],
  mapping: null,
  excluded: false,
});

const level = (selected: string[]): Level => ({
  groups: [{ parentPath: "/r/Clients", nodes: ["/r/Clients/Acme", "/r/Clients/Beta", "/r/Clients/Core"].map(node) }],
  selected,
});

const paths = (l: Level) => levelTargets(l).targets.map((n) => n.folder_path);

describe("levelTargets", () => {
  it("names every folder when none are selected", () => {
    expect(paths(level([]))).toHaveLength(3);
    expect(levelTargets(level([])).partial).toBe(false);
  });

  it("names every folder when all are selected", () => {
    const all = level(["/r/Clients/Acme", "/r/Clients/Beta", "/r/Clients/Core"]);
    expect(paths(all)).toHaveLength(3);
    expect(levelTargets(all).partial).toBe(false);
  });

  it("names only the selected folders when some are selected", () => {
    const some = level(["/r/Clients/Beta"]);
    expect(paths(some)).toEqual(["/r/Clients/Beta"]);
    expect(levelTargets(some).partial).toBe(true);
  });
});

describe("level captions", () => {
  const name = (p: string) => p.split("/").pop() ?? p;

  it("says how many folders a partial selection names", () => {
    expect(levelCaption(level(["/r/Clients/Acme"]), false, name)).toBe("1 of 3 folders in Clients");
    expect(levelCaption(level([]), false, name)).toBe("3 folders in Clients");
    expect(levelCaption(level([]), true, name)).toBe("Saved");
  });

  it("shows how far a shared name reaches", () => {
    expect(levelCaption(level([]), false, name, { "/r/Clients/Acme": "Client" })).toBe("Client · 1 of 3");
  });
});

describe("levelCoverage", () => {
  const nodes = levelNodes(level([]));

  it("finds the one name every named folder shares", () => {
    const c = levelCoverage(nodes, { "/r/Clients/Acme": "Client", "/r/Clients/Beta": "Client" });
    expect(c).toMatchObject({ name: "Client", named: 2, total: 3, mixed: false });
  });

  it("summarises different names with their counts", () => {
    const labels = { "/r/Clients/Acme": "Client", "/r/Clients/Beta": "Client", "/r/Clients/Core": "Project" };
    expect(levelCoverage(nodes, labels)).toMatchObject({ name: null, mixed: true, summary: "Client (2) · Project (1)" });
  });

  it("has no name when nothing is named", () => {
    expect(levelCoverage(nodes, {})).toMatchObject({ name: null, named: 0, mixed: false });
  });
});

describe("levelExtension", () => {
  const [A, B, C] = ["/r/Clients/Acme", "/r/Clients/Beta", "/r/Clients/Core"];

  it("offers the shared name to every unnamed folder", () => {
    expect(levelExtension(level([]), { [A]: "Client" })).toEqual({ name: "Client", paths: [B, C], partial: false });
  });

  it("offers it only to the selected ones when some are selected", () => {
    expect(levelExtension(level([C]), { [A]: "Client" })).toEqual({ name: "Client", paths: [C], partial: true });
  });

  it("offers nothing when names differ, none are named, all are, or a folder is excluded", () => {
    expect(levelExtension(level([]), { [A]: "Client", [B]: "Project" })).toBeNull();
    expect(levelExtension(level([]), {})).toBeNull();
    expect(levelExtension(level([]), { [A]: "Client", [B]: "Client", [C]: "Client" })).toBeNull();
    expect(levelExtension(level([]), { [A]: "Client", [B]: "Client" }, (p) => p === C)).toBeNull();
  });
});

describe("selectAllInLevel", () => {
  const all = ["/r/Clients/Acme", "/r/Clients/Beta", "/r/Clients/Core"];

  it("selects every folder", () => {
    expect(selectAllInLevel(level(["/r/Clients/Beta"]))).toEqual(all);
    expect(selectAllInLevel(level(all))).toEqual(all);
  });

  it("clears a full selection when toggling", () => {
    expect(selectAllInLevel(level(all), true)).toEqual([]);
    expect(selectAllInLevel(level([]), true)).toEqual(all);
  });
});

describe("rebuildLevels", () => {
  // Clients/{Acme,Beta}, each with Projects/{X,Y}
  const children: Record<string, string[]> = {
    "/r/Clients/Acme": ["/r/Clients/Acme/X", "/r/Clients/Acme/Y"],
    "/r/Clients/Beta": ["/r/Clients/Beta/X", "/r/Clients/Beta/Y"],
    "/r/Clients/Acme/X": ["/r/Clients/Acme/X/1"],
  };
  const childrenOf = (p: string) => (children[p] ?? []).map(node);
  const top = (selected: string[]): Level => ({
    groups: [{ parentPath: "/r/Clients", nodes: ["/r/Clients/Acme", "/r/Clients/Beta"].map(node) }],
    selected,
  });

  it("keeps the open path when the selection above widens", () => {
    const opened = rebuildLevels([top(["/r/Clients/Acme"])], 0, childrenOf);
    opened[1] = { ...opened[1], selected: ["/r/Clients/Acme/X"] };
    const deeper = rebuildLevels(opened, 1, childrenOf);
    expect(deeper).toHaveLength(3);

    const widened = rebuildLevels([top(["/r/Clients/Acme", "/r/Clients/Beta"]), ...deeper.slice(1)], 0, childrenOf);
    expect(widened[1].groups.map((g) => g.parentPath)).toEqual(["/r/Clients/Acme", "/r/Clients/Beta"]);
    expect(widened[1].selected).toEqual(["/r/Clients/Acme/X"]);
    expect(widened[2].groups.map((g) => g.parentPath)).toEqual(["/r/Clients/Acme/X"]);
  });

  it("drops selections no longer shown, and the levels under them", () => {
    const levels = rebuildLevels([top(["/r/Clients/Acme"])], 0, childrenOf);
    levels[1] = { ...levels[1], selected: ["/r/Clients/Acme/X"] };
    const narrowed = rebuildLevels([top(["/r/Clients/Beta"]), ...rebuildLevels(levels, 1, childrenOf).slice(1)], 0, childrenOf);
    expect(narrowed).toHaveLength(2);
    expect(narrowed[1].selected).toEqual([]);
  });

  it("groups children in folder order, not click order", () => {
    const levels = rebuildLevels([top(["/r/Clients/Beta", "/r/Clients/Acme"])], 0, childrenOf);
    expect(levels[1].groups.map((g) => g.parentPath)).toEqual(["/r/Clients/Acme", "/r/Clients/Beta"]);
  });
});

describe("clickSelection", () => {
  const [A, B, C] = ["/r/Clients/Acme", "/r/Clients/Beta", "/r/Clients/Core"];

  it("toggles one folder on a plain click", () => {
    expect(clickSelection(level([A]), C, A, false)).toEqual([A, C]);
    expect(clickSelection(level([A, C]), C, A, false)).toEqual([A]);
  });

  it("selects everything between the anchor and the shift-clicked folder", () => {
    expect(clickSelection(level([A]), C, A, true)).toEqual([A, B, C]);
    expect(clickSelection(level([C]), A, C, true).sort()).toEqual([A, B, C]);
  });

  it("falls back to a toggle when the anchor isn't in this level", () => {
    expect(clickSelection(level([]), C, null, true)).toEqual([C]);
    expect(clickSelection(level([]), C, "/elsewhere", true)).toEqual([C]);
  });
});
