// Finder column view (Miller columns): pure navigation and layout logic.
//
// The browser renders a tree of nodes. Today the tree is the flat list of
// files in a location; once folder data is supplied, folder nodes (those with
// `children`) open into a new column to the right.

import type { FileRecord } from "../types";
import { fileName, groupFiles, type Arrangement, type PropertyGrouping } from "./arrange";
import { compareSortValues } from "./columns";

export interface BrowserNode {
  id: string;
  name: string;
  /** Present for files. */
  file?: FileRecord;
  /** Present for folders (possibly empty). */
  children?: BrowserNode[];
  /** A virtual folder's place in its level's order, which it keeps whatever the arrangement. */
  order?: number;
}

export function isFolder(node: BrowserNode): boolean {
  return node.children !== undefined;
}

export function fileNode(file: FileRecord): BrowserNode {
  return { id: file.file_id, name: fileName(file.file_path), file };
}

/**
 * The lists shown in each column for a selection path (one selected node id
 * per column). Column 0 is the root; each selected folder adds a column of its
 * children. Resolution stops at the first id that isn't found.
 */
export function resolveColumns(root: BrowserNode[], path: string[]): {
  columns: BrowserNode[][];
  selected: BrowserNode[];
} {
  const columns: BrowserNode[][] = [root];
  const selected: BrowserNode[] = [];
  let current = root;
  for (const id of path) {
    const node = current.find((n) => n.id === id);
    if (!node) break;
    selected.push(node);
    if (!node.children) break;
    columns.push(node.children);
    current = node.children;
  }
  return { columns, selected };
}

/** Selecting `id` in column `depth` replaces the selection from that column onwards. */
export function selectAt(path: string[], depth: number, id: string | null): string[] {
  const kept = path.slice(0, depth);
  return id == null ? kept : [...kept, id];
}

/**
 * Column widths after the selection changes: columns up to `keepThrough` keep
 * their width, and every newly opened column inherits the width of the column
 * to its left (Finder behaviour).
 */
export function inheritWidths(
  widths: number[],
  keepThrough: number,
  count: number,
  defaultWidth: number
): number[] {
  const next = widths.slice(0, Math.min(keepThrough + 1, count));
  while (next.length < count) next.push(next[next.length - 1] ?? defaultWidth);
  return next;
}

export interface NodeGroup {
  label: string;
  /** Grouped by a property: the value the group stands for ("" for the No-value group). */
  value?: string;
  nodes: BrowserNode[];
}

/**
 * Orders a column: folders on top (by name), then files arranged by the
 * current Sort By / Group By. When grouping, folders get their own group.
 */
export function arrangeColumn(nodes: BrowserNode[], arrangement: Arrangement, byProperty?: PropertyGrouping): NodeGroup[] {
  const folders = nodes
    .filter(isFolder)
    .sort((a, b) =>
      a.order != null && b.order != null ? a.order - b.order : compareSortValues(a.name, b.name, "asc")
    );
  const files = nodes.filter((n) => !isFolder(n) && n.file);
  const byId = new Map(files.map((n) => [n.file!.file_id, n]));

  const fileGroups = groupFiles(
    files.map((n) => n.file!),
    arrangement,
    new Date(),
    byProperty
  ).map((g) => ({ label: g.label, value: g.value, nodes: g.files.map((f) => byId.get(f.file_id)!) }));

  // Not grouped (or by a property it can't read)
  if (fileGroups.length === 1 && fileGroups[0].label === "") {
    return [{ label: "", nodes: [...folders, ...fileGroups[0].nodes] }];
  }
  return [
    ...(folders.length > 0 ? [{ label: "Folders", nodes: folders }] : []),
    ...fileGroups.filter((g) => g.nodes.length > 0),
  ];
}

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/**
 * Keyboard navigation. `ordered` gives each column's nodes in display order.
 * Up/Down move within the active column, Right enters the selected folder,
 * Left returns to the parent column.
 */
export function navigate(path: string[], ordered: BrowserNode[][], key: ArrowKey): string[] {
  const depth = Math.max(path.length - 1, 0);
  const column = ordered[depth] ?? [];
  const index = column.findIndex((n) => n.id === path[depth]);

  switch (key) {
    case "ArrowDown":
    case "ArrowUp": {
      if (column.length === 0) return path;
      const next =
        index === -1
          ? key === "ArrowDown" ? 0 : column.length - 1
          : Math.min(column.length - 1, Math.max(0, index + (key === "ArrowDown" ? 1 : -1)));
      return selectAt(path, depth, column[next].id);
    }
    case "ArrowRight": {
      const node = column[index];
      const children = node && ordered[depth + 1];
      if (!node?.children || !children || children.length === 0) return path;
      return [...path, children[0].id];
    }
    case "ArrowLeft":
      return path.length > 1 ? path.slice(0, -1) : path;
  }
}
