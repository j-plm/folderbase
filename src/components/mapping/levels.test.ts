import { describe, expect, it } from "vitest";
import type { FolderTreeNode } from "../../lib/commands";
import { clickSelection, levelCaption, levelName, levelPlaceholder, levelTargets, type Level } from "./levels";

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

describe("level headings", () => {
  const name = (p: string) => p.split("/").pop() ?? p;

  it("says how many folders a partial selection names", () => {
    expect(levelPlaceholder(level(["/r/Clients/Acme", "/r/Clients/Core"]), {})).toBe("Name 2 of 3 folders");
    expect(levelCaption(level(["/r/Clients/Acme"]), false, name)).toBe("1 of 3 folders in Clients");
    expect(levelPlaceholder(level([]), {})).toBe("Name this level");
  });

  it("summarises different names with their counts", () => {
    const labels = { "/r/Clients/Acme": "Client", "/r/Clients/Beta": "Client", "/r/Clients/Core": "Project" };
    const { targets } = levelTargets(level([]));
    expect(levelName(targets, labels)).toEqual({ value: "", mixed: true, summary: "Client (2) · Project (1)" });
    expect(levelPlaceholder(level([]), labels)).toBe("Client (2) · Project (1)");
  });

  it("shows the shared name of the folders being named", () => {
    const labels = { "/r/Clients/Acme": "Client" };
    expect(levelName(levelTargets(level(["/r/Clients/Acme"])).targets, labels).value).toBe("Client");
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
