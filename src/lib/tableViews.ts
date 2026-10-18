import type { SortState } from "./columns";
import type { FilterMatch, FilterRule } from "./dbTable";
import type { GroupLevel } from "./dbGroups";

/** A saved view of a location's files, as the database stores it (see commands::location_views). */
export interface StoredView {
  view_id: string;
  location_id: string;
  name: string;
  is_default: boolean;
  position: number;
  /** JSON: a ViewDefinition. */
  definition: string;
  /** JSON: a named view's unsaved edits (null: none). */
  draft: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * How the Database view shows a location's files. Search, selection, scroll
 * and folded groups are left out: they belong to the moment, not the view.
 */
export interface TableDefinition {
  filters: FilterRule[];
  match: FilterMatch;
  sorts: SortState[];
  groups: GroupLevel[];
  /** Standard columns turned off (Name never is). */
  hiddenStandard: string[];
  /** Column ids in the order dragged into; columns not listed keep their place. */
  columnOrder: string[];
  showTags: boolean;
  /** Source Tags shows only tags not yet recorded in a property. */
  hideCovered: boolean;
  wrapSourceTags: boolean;
  /** Properties shown as columns, by name. */
  visibleProperties: string[];
  /** Multi-select properties whose values stay on one line. */
  noWrap: string[];
  frozen: boolean;
}

/**
 * A view's whole definition. Only the table for now; a folder presentation,
 * with its own layers, can sit beside it later without touching this.
 */
export interface ViewDefinition {
  table: TableDefinition;
}

export const DEFAULT_VIEW_NAME = "Default";

export const DEFAULT_SORT: SortState = { key: "path", direction: "asc" };

export function emptyTable(): TableDefinition {
  return {
    filters: [],
    match: "all",
    sorts: [DEFAULT_SORT],
    groups: [],
    hiddenStandard: [],
    columnOrder: [],
    showTags: false,
    hideCovered: false,
    wrapSourceTags: true,
    visibleProperties: [],
    noWrap: [],
    frozen: true,
  };
}

const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const list = <T>(v: unknown): T[] | undefined => (Array.isArray(v) ? (v as T[]) : undefined);

/** A stored definition, with anything missing or malformed filled from the defaults. */
export function parseViewDefinition(json: string | null | undefined): ViewDefinition {
  const base = emptyTable();
  let t: Record<string, unknown> = {};
  try {
    const parsed = json ? (JSON.parse(json) as { table?: unknown }) : null;
    if (parsed && typeof parsed.table === "object" && parsed.table) t = parsed.table as Record<string, unknown>;
  } catch {
    // A broken definition shows the files plainly rather than not at all
  }
  return {
    table: {
      filters: list<FilterRule>(t.filters) ?? base.filters,
      match: t.match === "any" ? "any" : "all",
      sorts: list<SortState>(t.sorts) ?? base.sorts,
      groups: list<GroupLevel>(t.groups) ?? base.groups,
      hiddenStandard: strings(t.hiddenStandard) ?? base.hiddenStandard,
      columnOrder: strings(t.columnOrder) ?? base.columnOrder,
      showTags: bool(t.showTags) ?? base.showTags,
      hideCovered: bool(t.hideCovered) ?? base.hideCovered,
      wrapSourceTags: bool(t.wrapSourceTags) ?? base.wrapSourceTags,
      visibleProperties: strings(t.visibleProperties) ?? base.visibleProperties,
      noWrap: strings(t.noWrap) ?? base.noWrap,
      frozen: bool(t.frozen) ?? base.frozen,
    },
  };
}

/** The definition as stored: keys in a fixed order, so equal views compare equal as text. */
export function serializeViewDefinition(def: ViewDefinition): string {
  const t = def.table;
  const table: TableDefinition = {
    filters: t.filters.map((f) => ({ id: f.id, column: f.column, op: f.op, value: f.value })),
    match: t.match,
    sorts: t.sorts.map((s) => ({ key: s.key, direction: s.direction })),
    groups: t.groups.map((g) => ({ key: g.key, direction: g.direction })),
    hiddenStandard: t.hiddenStandard,
    columnOrder: t.columnOrder,
    showTags: t.showTags,
    hideCovered: t.hideCovered,
    wrapSourceTags: t.wrapSourceTags,
    visibleProperties: t.visibleProperties,
    noWrap: t.noWrap,
    frozen: t.frozen,
  };
  return JSON.stringify({ table });
}

export function sameViewDefinition(a: ViewDefinition, b: ViewDefinition): boolean {
  return serializeViewDefinition(a) === serializeViewDefinition(b);
}

/** What the view shows now: its unsaved edits, else what was saved. */
export function workingDefinition(view: StoredView): ViewDefinition {
  return parseViewDefinition(view.draft ?? view.definition);
}

/**
 * The definition a location's default view starts from: the column settings
 * it had before views existed (kept per location in local storage), so
 * nobody's columns reset. `read` returns a stored value or undefined.
 */
export function legacyTable(read: (key: string) => unknown): TableDefinition {
  const base = emptyTable();
  return {
    ...base,
    groups: list<GroupLevel>(read("col-group")) ?? base.groups,
    hiddenStandard: strings(read("col-hidden")) ?? base.hiddenStandard,
    columnOrder: strings(read("col-order")) ?? base.columnOrder,
    showTags: bool(read("col-tags")) ?? base.showTags,
    hideCovered: bool(read("col-tags-hide-covered")) ?? base.hideCovered,
    wrapSourceTags: bool(read("col-wrap-source")) ?? base.wrapSourceTags,
    visibleProperties: strings(read("col-props")) ?? base.visibleProperties,
    noWrap: strings(read("col-nowrap")) ?? base.noWrap,
    frozen: bool(read("col-freeze")) ?? base.frozen,
  };
}

/** "By Client" → "By Client 2" (ignoring case), for Duplicate and Save as New View. */
export function uniqueViewName(name: string, taken: string[]): string {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  let i = 2;
  while (lower.has(`${name} ${i}`.toLowerCase())) i++;
  return `${name} ${i}`;
}
