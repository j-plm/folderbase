import { DATE_UNITS, type DateUnit } from "./dateFolders";
import type { SortState } from "./columns";
import type { FilterItem, FilterMatch } from "./dbTable";
import { parseFilterItems, serializeFilterItems } from "./filterTree";
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
  /** Filters and groups of them, combined by `match` (each group by its own). */
  filters: FilterItem[];
  match: FilterMatch;
  sorts: SortState[];
  groups: GroupLevel[];
  /** Standard columns turned off (Name never is). */
  hiddenStandard: string[];
  /** Column ids in the order dragged into; columns not listed keep their place. */
  columnOrder: string[];
  showTags: boolean;
  /** Path Tags shows only tags not yet recorded in a property. */
  hideCovered: boolean;
  wrapSourceTags: boolean;
  /** Properties shown as columns, by name. */
  visibleProperties: string[];
  /**
   * Custom properties show as columns when the rows shown have a value in
   * them, so the columns follow the folder or filter you're in;
   * `visibleProperties` then holds only the values read from files.
   */
  nonEmptyColumns: boolean;
  /** Multi-select properties whose values stay on one line. */
  noWrap: string[];
  frozen: boolean;
  /** While the table isn't grouped itself, the view's folders below where you are group it. */
  folderGroups: boolean;
}

/** One folder level (spec ▸ Layers): a column's values become the folders. */
export interface FolderLevel {
  /** A column id, as in a group level: "prop:Client", "type", "created"… */
  column: string;
  direction: "asc" | "desc";
  /** What sits inside these folders unless a branch says otherwise; null: files. */
  next: FolderLevel | null;
  /** A different structure inside particular folders, by folder value (spec ▸ Branching Hierarchies). */
  branches: Record<string, FolderLevel | null>;
  /**
   * Where files with no value here go — those the property doesn't apply to
   * (a conditional one) as well as those still to fill in: loose beside the
   * folders, or in a "No Client" folder. Left out: a folder, but loose for a
   * conditional property (lib/folderTree noValuePlacement).
   */
  noValue?: "loose" | "folder";
  /** Every registered value is a folder here, even with no files in it yet (Select and Multi-select). */
  allValues?: true;
  /** What a date level's folders are (lib/dateFolders); left out: the column's default. */
  dateUnit?: DateUnit;
  /** A folder of this level holding just one folder (and no files) shows merged with it ("2024 › Tax"). */
  skipSingle?: true;
}

/** A folder shown though no file in the view is in it yet (New Folder): only inside the folder it was made in. */
export interface FolderPin {
  /** The folder it's in, as the columns and values on the way ([] the view's top). */
  at: { column: string; value: string }[];
  column: string;
  value: string;
}

/** How Icons, List and Columns show the view's files as folders. */
export interface FolderDefinition {
  /** null: no folders, just the files. */
  root: FolderLevel | null;
  /** Folders made with New Folder; read as none when left out. */
  pins?: FolderPin[];
}

/**
 * A view's whole definition: the Database view's table, and the folders the
 * other modes show. Both see the same files (the table's filters).
 */
export interface ViewDefinition {
  table: TableDefinition;
  /** Left out by callers that only change the table; read as no folders. */
  folders?: FolderDefinition;
}

export function emptyFolders(): FolderDefinition {
  return { root: null, pins: [] };
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
    nonEmptyColumns: true,
    noWrap: [],
    frozen: true,
    // Off until switched on in the Group popover
    folderGroups: false,
  };
}

const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const list = <T>(v: unknown): T[] | undefined => (Array.isArray(v) ? (v as T[]) : undefined);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A stored folder level, or null when it's missing or malformed (files show there instead). */
function parseFolderLevel(v: unknown): FolderLevel | null {
  if (!isObject(v) || typeof v.column !== "string" || !v.column) return null;
  const branches: Record<string, FolderLevel | null> = {};
  if (isObject(v.branches)) {
    for (const [value, level] of Object.entries(v.branches)) branches[value] = parseFolderLevel(level);
  }
  return {
    column: v.column,
    direction: v.direction === "desc" ? "desc" : "asc",
    next: parseFolderLevel(v.next),
    branches,
    ...(v.noValue === "loose" || v.noValue === "folder" ? { noValue: v.noValue as "loose" | "folder" } : {}),
    ...(v.allValues === true ? { allValues: true as const } : {}),
    ...(v.skipSingle === true ? { skipSingle: true as const } : {}),
    ...(typeof v.dateUnit === "string" && DATE_UNITS.some((u) => u.unit === v.dateUnit) ? { dateUnit: v.dateUnit as DateUnit } : {}),
  };
}

function skippingEverywhere(level: FolderLevel | null): FolderLevel | null {
  if (!level) return null;
  const branches: Record<string, FolderLevel | null> = {};
  for (const [value, fork] of Object.entries(level.branches)) branches[value] = skippingEverywhere(fork);
  return { ...level, skipSingle: true, next: skippingEverywhere(level.next), branches };
}

function parsePins(v: unknown): FolderPin[] {
  if (!Array.isArray(v)) return [];
  const step = (s: unknown) => isObject(s) && typeof s.column === "string" && typeof s.value === "string";
  return v
    .filter((p): p is FolderPin => isObject(p) && step(p) && Array.isArray(p.at) && p.at.every(step))
    .map((p) => orderedPin(p));
}

const orderedPin = (p: FolderPin): FolderPin => ({
  at: p.at.map((s) => ({ column: s.column, value: s.value })),
  column: p.column,
  value: p.value,
});

/** A folder level with its keys in a fixed order, and branches by value, so equal structures compare equal as text. */
function orderedFolderLevel(level: FolderLevel | null): FolderLevel | null {
  if (!level) return null;
  const branches: Record<string, FolderLevel | null> = {};
  for (const value of Object.keys(level.branches).sort()) branches[value] = orderedFolderLevel(level.branches[value]);
  return {
    column: level.column,
    direction: level.direction,
    next: orderedFolderLevel(level.next),
    branches,
    ...(level.noValue ? { noValue: level.noValue } : {}),
    ...(level.allValues ? { allValues: level.allValues } : {}),
    ...(level.dateUnit ? { dateUnit: level.dateUnit } : {}),
    ...(level.skipSingle ? { skipSingle: level.skipSingle } : {}),
  };
}

/** A stored definition, with anything missing or malformed filled from the defaults. */
export function parseViewDefinition(json: string | null | undefined): ViewDefinition {
  const base = emptyTable();
  let t: Record<string, unknown> = {};
  let folders: Record<string, unknown> = {};
  try {
    const parsed = json ? (JSON.parse(json) as { table?: unknown; folders?: unknown }) : null;
    if (parsed && isObject(parsed.table)) t = parsed.table;
    if (parsed && isObject(parsed.folders)) folders = parsed.folders;
  } catch {
    // A broken definition shows the files plainly rather than not at all
  }
  return {
    table: {
      filters: parseFilterItems(t.filters) ?? base.filters,
      match: t.match === "any" ? "any" : "all",
      sorts: list<SortState>(t.sorts) ?? base.sorts,
      groups: list<GroupLevel>(t.groups) ?? base.groups,
      hiddenStandard: strings(t.hiddenStandard) ?? base.hiddenStandard,
      columnOrder: strings(t.columnOrder) ?? base.columnOrder,
      showTags: bool(t.showTags) ?? base.showTags,
      hideCovered: bool(t.hideCovered) ?? base.hideCovered,
      wrapSourceTags: bool(t.wrapSourceTags) ?? base.wrapSourceTags,
      visibleProperties: strings(t.visibleProperties) ?? base.visibleProperties,
      nonEmptyColumns: bool(t.nonEmptyColumns) ?? base.nonEmptyColumns,
      noWrap: strings(t.noWrap) ?? base.noWrap,
      frozen: bool(t.frozen) ?? base.frozen,
      folderGroups: bool(t.folderGroups) ?? base.folderGroups,
    },
    folders: {
      // Skip Single Folders was once the whole view's: now every level's
      root: folders.skipSingle === true ? skippingEverywhere(parseFolderLevel(folders.root)) : parseFolderLevel(folders.root),
      pins: parsePins(folders.pins),
    },
  };
}

/** The definition as stored: keys in a fixed order, so equal views compare equal as text. */
export function serializeViewDefinition(def: ViewDefinition): string {
  const t = def.table;
  const table: TableDefinition = {
    filters: serializeFilterItems(t.filters),
    match: t.match,
    sorts: t.sorts.map((s) => ({ key: s.key, direction: s.direction })),
    groups: t.groups.map((g) => ({ key: g.key, direction: g.direction })),
    hiddenStandard: t.hiddenStandard,
    columnOrder: t.columnOrder,
    showTags: t.showTags,
    hideCovered: t.hideCovered,
    wrapSourceTags: t.wrapSourceTags,
    visibleProperties: t.visibleProperties,
    nonEmptyColumns: t.nonEmptyColumns,
    noWrap: t.noWrap,
    frozen: t.frozen,
    folderGroups: t.folderGroups,
  };
  const folders: FolderDefinition = {
    root: orderedFolderLevel(def.folders?.root ?? null),
    pins: (def.folders?.pins ?? []).map(orderedPin),
  };
  return JSON.stringify({ table, folders });
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
