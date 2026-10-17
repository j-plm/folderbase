import type { SortState } from "./columns";

// Multi-level grouping for the database view. Pure: the view supplies each
// row's group key per column; rows arrive already sorted, and keep that order
// inside their groups.

/** One grouping level: a column, and which way its groups run. */
export type GroupLevel = SortState;

/** Where a row falls for one level. `rank` orders the groups; null means the row has no value. */
export interface GroupKey {
  label: string;
  rank: number | string;
}

export interface RowGroup<T> {
  /** Stable across re-renders and re-sorts: the path of column=label pairs down to this group. */
  id: string;
  label: string;
  /** 0 for the outermost level. */
  depth: number;
  /** Rows in this group and every group inside it. */
  count: number;
  rows: T[];
  children: RowGroup<T>[];
}

export type GroupItem<T> =
  | { type: "group"; group: RowGroup<T>; collapsed: boolean }
  /** `index` is the row's position among the visible rows; `stripe` counts from 0 in each group. */
  | { type: "row"; row: T; index: number; stripe: number };

const SEP = "\u001f";

function compareRanks(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Splits `rows` into nested groups, one level per entry in `levels`. Groups are
 * ordered by rank (reversed for "desc"); rows without a value go in a last
 * group labelled by `emptyLabel`.
 */
export function groupRows<T>(
  rows: T[],
  levels: GroupLevel[],
  keyOf: (row: T, column: string) => GroupKey | null,
  emptyLabel: (column: string) => string,
  parentId = "",
  depth = 0
): RowGroup<T>[] {
  const [level, ...rest] = levels;
  if (!level) return [];

  const byLabel = new Map<string, { key: GroupKey | null; rows: T[] }>();
  for (const row of rows) {
    const key = keyOf(row, level.key);
    const label = key ? key.label : emptyLabel(level.key);
    // The empty group keeps its own slot even if a value happens to share its label
    const slot = key ? `v${SEP}${label}` : "empty";
    const group = byLabel.get(slot) ?? { key, rows: [] };
    group.rows.push(row);
    byLabel.set(slot, group);
  }

  const sign = level.direction === "desc" ? -1 : 1;
  return [...byLabel.values()]
    .sort((a, b) => {
      if (!a.key || !b.key) return a.key ? -1 : b.key ? 1 : 0;
      return sign * compareRanks(a.key.rank, b.key.rank);
    })
    .map(({ key, rows: groupRowsList }) => {
      const label = key ? key.label : emptyLabel(level.key);
      const id = `${parentId}${parentId ? SEP : ""}${level.key}=${key ? label : ""}`;
      return {
        id,
        label,
        depth,
        count: groupRowsList.length,
        rows: groupRowsList,
        children: groupRows(groupRowsList, rest, keyOf, emptyLabel, id, depth + 1),
      };
    });
}

/**
 * The table's rows in display order: each group's header, then (unless it is
 * collapsed) its subgroups or rows. With no groups, just the rows.
 */
export function flattenGroups<T>(
  rows: T[],
  groups: RowGroup<T>[] | null,
  collapsed: ReadonlySet<string>
): { items: GroupItem<T>[]; rows: T[] } {
  const items: GroupItem<T>[] = [];
  const visible: T[] = [];
  const pushRows = (list: T[]) =>
    list.forEach((row, stripe) => {
      items.push({ type: "row", row, index: visible.length, stripe });
      visible.push(row);
    });

  if (!groups) {
    pushRows(rows);
    return { items, rows: visible };
  }
  const walk = (list: RowGroup<T>[]) => {
    for (const group of list) {
      const isCollapsed = collapsed.has(group.id);
      items.push({ type: "group", group, collapsed: isCollapsed });
      if (isCollapsed) continue;
      if (group.children.length > 0) walk(group.children);
      else pushRows(group.rows);
    }
  };
  walk(groups);
  return { items, rows: visible };
}

/** Every group id in the tree, or only those at `depth`. */
export function groupIds<T>(groups: RowGroup<T>[], depth?: number): string[] {
  const ids: string[] = [];
  const walk = (list: RowGroup<T>[]) => {
    for (const g of list) {
      if (depth == null || g.depth === depth) ids.push(g.id);
      if (depth == null || g.depth < depth) walk(g.children);
    }
  };
  walk(groups);
  return ids;
}

/** A group's collapsed state flipped; with `all`, every group at its depth follows it (Option-click). */
export function toggleCollapsed<T>(
  collapsed: ReadonlySet<string>,
  group: RowGroup<T>,
  groups: RowGroup<T>[],
  all = false
): Set<string> {
  const next = new Set(collapsed);
  const collapse = !collapsed.has(group.id);
  for (const id of all ? groupIds(groups, group.depth) : [group.id]) {
    if (collapse) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** Every group at `depth` folded shut (true) or opened (false); the rest keep their state. */
export function setLevelCollapsed<T>(
  collapsed: ReadonlySet<string>,
  groups: RowGroup<T>[],
  depth: number,
  collapse: boolean
): Set<string> {
  const next = new Set(collapsed);
  for (const id of groupIds(groups, depth)) {
    if (collapse) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** Whether every group at `depth` is collapsed, none is, or some are. */
export function levelState<T>(
  collapsed: ReadonlySet<string>,
  groups: RowGroup<T>[],
  depth: number
): "collapsed" | "expanded" | "mixed" {
  const ids = groupIds(groups, depth);
  const shut = ids.filter((id) => collapsed.has(id)).length;
  if (ids.length > 0 && shut === ids.length) return "collapsed";
  return shut === 0 ? "expanded" : "mixed";
}
