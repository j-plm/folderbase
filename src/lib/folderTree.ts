import { dateGroupRange, sizeGroupRange } from "./arrange";
import { applyFilters, newRule, type ColumnKind, type FilterMatch, type FilterOp, type FilterRule } from "./dbTable";
import type { GroupLevel, RowGroup } from "./dbGroups";
import { NATIVE_LABELS, PROP_PREFIX, nativeValue, propName } from "./fileColumns";
import { isEmptyValue, type ValueReader } from "./fileValues";
import { dateKey, listValues, propertyLabel, valueToText } from "./propertyTypes";
import { dateFolder, dateFolderRange, defaultDateUnit, type DateUnit, isDateColumn } from "./dateFolders";
import type { FolderLevel, FolderPin } from "./tableViews";
import type { FileRecord, ValueType } from "../types";

// A view's files as virtual folders (spec ▸ Virtual Folder Layer): each folder
// level's column groups the files below it, and its values are the folders.
// Pure, so the hierarchy editor (and later Icons, List and Columns)
// only render what this works out.

/** The folder for files with no value at a level ("No Client"). */
export const NO_VALUE = "";

/** Native columns a level can use, in Finder's Group By order. */
export const FOLDER_NATIVE_COLUMNS: { id: string; label: string }[] = [
  { id: "type", label: "Kind" },
  { id: "ext", label: "Extension" },
  { id: "created", label: "Created" },
  { id: "modified", label: "Modified" },
  { id: "size", label: "Size" },
  { id: "tags", label: "Path Tags" },
];

/** A level's column as folders name it ("No Client", "No Kind"). */
export function folderColumnLabel(column: string): string {
  if (column.startsWith(PROP_PREFIX)) return propertyLabel(propName(column));
  return FOLDER_NATIVE_COLUMNS.find((c) => c.id === column)?.label ?? NATIVE_LABELS[column] ?? column;
}

/** Columns whose files go in a folder per value (spec ▸ Multi-folder Presence), not one per combination. */
const NATIVE_LISTS = new Set(["tags"]);

export interface FolderKey {
  /** What identifies the folder (and keys its branch): the value itself, or "2024-03" for a month. */
  value: string;
  label: string;
  rank: string | number;
}

export interface FolderEntry extends FolderKey {
  /** Files in the folder, at any depth below it. */
  count: number;
  /** What's inside it: the next level, or null for files. */
  inside: FolderLevel | null;
}

export interface FolderContents {
  /** The level shown here (null: files, no more folders). */
  level: FolderLevel | null;
  folders: FolderEntry[];
  /** Files sitting here rather than in a folder: all of them at the bottom, or those the level's property doesn't apply to. */
  files: FileRecord[];
}

/** The view's files: its filters applied, as the Database view applies them. */
export function viewFiles(files: FileRecord[], filters: FilterRule[], match: FilterMatch, reader: ValueReader): FileRecord[] {
  return applyFilters(files, filters, match, reader.columnValue, reader.kindOf);
}

/** What sits inside folder `value` of a level: its branch, or the level's usual next one. */
export function insideOf(level: FolderLevel, value: string): FolderLevel | null {
  return Object.prototype.hasOwnProperty.call(level.branches, value) ? level.branches[value] : level.next;
}

/** The level shown at a path of folder values ([] is the top); null when files show there. */
export function levelAt(root: FolderLevel | null, path: string[]): FolderLevel | null {
  let level = root;
  for (const value of path) {
    if (!level) return null;
    level = insideOf(level, value);
  }
  return level;
}

/**
 * The folders a file goes in at a level: one per value for a Multi-select or
 * Path Tags, otherwise one, with "No value" when it has none. Null when the
 * level's property doesn't apply to the file (a scoped property): it sits
 * beside the folders instead.
 */
export function folderKeys(
  file: FileRecord,
  column: string,
  reader: ValueReader,
  typeOf: (name: string) => ValueType,
  /** A date level's unit (lib/dateFolders); left out: the column's default. */
  unit?: DateUnit
): FolderKey[] | null {
  const none: FolderKey[] = [{ value: NO_VALUE, label: "", rank: "" }];
  const each = (values: string[]) =>
    values.length === 0 ? none : [...new Set(values)].map((v) => ({ value: v, label: v, rank: v }));
  if (column.startsWith(PROP_PREFIX)) {
    const name = propName(column);
    const v = reader.effectiveValue(file, name);
    if (isEmptyValue(v)) return reader.scopeOf(name) && !reader.appliesTo(file, name) ? null : none;
    if (typeOf(name) === "array") return each(listValues(v).map(valueToText).filter((s) => s.trim() !== ""));
  } else if (NATIVE_LISTS.has(column)) {
    return each(listValues(nativeValue(file, column)));
  }
  // A date by a chosen unit (Finder's relative buckets are the groups' own)
  if (unit && unit !== "relative" && isDateColumn(column, typeOf)) {
    const day = dayOf(file, column, reader);
    return day ? [dateFolder(day, unit)] : none;
  }
  const key = reader.groupKey(file, column);
  if (!key) return none;
  // A month keys its branch by "2024-03", so the branch outlives the label's wording
  const value = typeof key.rank === "string" && /^\d{4}-\d{2}$/.test(key.rank) ? key.rank : key.label;
  return [{ value, label: key.label, rank: key.rank }];
}

/** The day a date column holds for a file ("2024-03-12"): a date property's value, or the file's own date where it is. */
function dayOf(file: FileRecord, column: string, reader: ValueReader): string | null {
  if (column.startsWith(PROP_PREFIX)) return dateKey(valueToText(reader.effectiveValue(file, propName(column))));
  const iso = column === "created" ? file.timestamp : (file.modified_at ?? file.timestamp);
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function compareRank(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export interface FolderTree {
  /** The files (at any depth) in the folder at a path. */
  filesAt: (path: string[]) => FileRecord[];
  contents: (path: string[]) => FolderContents;
  /** The folder values at a path. */
  valuesAt: (path: string[]) => string[];
}

/**
 * A view's files as folders, worked out per path as asked for (and kept).
 * `label` names a column, for its "No Client" folder.
 */
/** Folders shown with no files in them yet. */
export interface FolderExtras {
  /** Folders made with New Folder, each only inside the folder it was made in. */
  pins?: FolderPin[];
  /** A column's registered values, for a level showing all of them. */
  registered?: (column: string) => string[];
}

/**
 * Where a level puts files with no value: in a "No Client" folder, or loose
 * beside the folders. A conditional property's files are loose unless the
 * level says otherwise (most files aren't meant to have it).
 */
export function noValuePlacement(level: Pick<FolderLevel, "column" | "noValue">, reader: ValueReader): "loose" | "folder" {
  if (level.noValue) return level.noValue;
  return level.column.startsWith(PROP_PREFIX) && reader.scopeOf(propName(level.column)) ? "loose" : "folder";
}

export function folderTree(
  files: FileRecord[],
  root: FolderLevel | null,
  reader: ValueReader,
  typeOf: (name: string) => ValueType,
  label: (column: string) => string,
  extras: FolderExtras = {}
): FolderTree {
  const filesCache = new Map<string, FileRecord[]>();
  const contentsCache = new Map<string, FolderContents>();
  const keysCache = new Map<string, Map<string, FolderKey[] | null>>();

  const keysOf = (file: FileRecord, level: FolderLevel) => {
    const at = `${level.column}|${level.dateUnit ?? ""}`;
    let byFile = keysCache.get(at);
    if (!byFile) keysCache.set(at, (byFile = new Map()));
    if (!byFile.has(file.file_id)) byFile.set(file.file_id, folderKeys(file, level.column, reader, typeOf, level.dateUnit));
    return byFile.get(file.file_id) ?? null;
  };

  const filesAt = (path: string[]): FileRecord[] => {
    const id = JSON.stringify(path);
    const cached = filesCache.get(id);
    if (cached) return cached;
    let result = files;
    if (path.length > 0) {
      const parent = path.slice(0, -1);
      const level = levelAt(root, parent);
      const value = path[path.length - 1];
      if (!level) result = [];
      else {
        // The "No Client" folder holds those it doesn't apply to as well, when they aren't loose
        const unapplied = value === NO_VALUE && noValuePlacement(level, reader) === "folder";
        result = filesAt(parent).filter((f) => {
          const keys = keysOf(f, level);
          return keys ? keys.some((k) => k.value === value) : unapplied;
        });
      }
    }
    filesCache.set(id, result);
    return result;
  };

  const contents = (path: string[]): FolderContents => {
    const id = JSON.stringify(path);
    const cached = contentsCache.get(id);
    if (cached) return cached;
    const inside = filesAt(path);
    const level = levelAt(root, path);
    let result: FolderContents;
    if (!level) {
      result = { level: null, folders: [], files: inside };
    } else {
      const folders = new Map<string, FolderEntry>();
      const loose: FileRecord[] = [];
      const placement = noValuePlacement(level, reader);
      for (const file of inside) {
        const keys = keysOf(file, level);
        // No value here: loose beside the folders when the level says so, as are files its property doesn't apply to
        const empty = !keys || (keys.length === 1 && keys[0].value === NO_VALUE);
        if (empty && placement === "loose") {
          loose.push(file);
          continue;
        }
        // No value (or the property doesn't apply): the "No Client" folder
        const placed = keys ?? [{ value: NO_VALUE, label: "", rank: "" }];
        for (const key of placed) {
          const entry = folders.get(key.value);
          if (entry) entry.count++;
          else folders.set(key.value, { ...key, count: 1, inside: insideOf(level, key.value) });
        }
      }
      // Empty folders: every registered value, or those made here with New Folder
      const empty = (value: string) => {
        if (!folders.has(value)) folders.set(value, { value, label: value, rank: value, count: 0, inside: insideOf(level, value) });
      };
      if (level.allValues) for (const value of extras.registered?.(level.column) ?? []) empty(value);
      for (const pin of extras.pins ?? []) {
        if (pin.column === level.column && samePinPlace(pin.at, pinPlace(root, path))) empty(pin.value);
      }
      const none = folders.get(NO_VALUE);
      if (none) none.label = `No ${label(level.column)}`;
      const sign = level.direction === "desc" ? -1 : 1;
      const sorted = [...folders.values()].sort((a, b) => {
        // "No Client" comes last whichever way the level runs
        if ((a.value === NO_VALUE) !== (b.value === NO_VALUE)) return a.value === NO_VALUE ? 1 : -1;
        return sign * compareRank(a.rank, b.rank);
      });
      result = { level, folders: sorted, files: loose };
    }
    contentsCache.set(id, result);
    return result;
  };

  const valuesAt = (path: string[]) => contents(path).folders.map((f) => f.value);

  return { filesAt, contents, valuesAt };
}

const samePinPlace = (a: FolderPin["at"], b: FolderPin["at"]) =>
  a.length === b.length && a.every((s, i) => s.column === b[i].column && s.value === b[i].value);

/** Where a folder made at a place is recorded: the columns and values on the way. */
export function pinPlace(root: FolderLevel | null, path: string[]): FolderPin["at"] {
  return path.map((value, i) => ({ column: levelAt(root, path.slice(0, i))?.column ?? "", value }));
}

// ── Places ─────────────────────────────────────────────────────────────────

/** A folder's id among the items a view mode shows (selection, keys), apart from any file's. */
export const folderItemId = (value: string) => `folder:${value}`;

/**
 * The part of a place (a path of folder values) that's still there: a value
 * renamed away, files refiled or the structure changed cut it back to the
 * deepest folder left. The same array when all of it is.
 */
export function placeWithin(tree: FolderTree, path: string[]): string[] {
  for (let i = 0; i < path.length; i++) {
    if (!tree.contents(path.slice(0, i)).folders.some((f) => f.value === path[i])) return path.slice(0, i);
  }
  return path;
}

export interface PlaceStep {
  value: string;
  /** The folder's name: "Josh", "March 2024", "No Person". */
  label: string;
  /** The place this step leads to. */
  path: string[];
}

/** Each folder on the way to a place, named as it shows. */
export function placeSteps(tree: FolderTree, path: string[]): PlaceStep[] {
  return path.map((value, i) => {
    const parent = path.slice(0, i);
    const entry = tree.contents(parent).folders.find((f) => f.value === value);
    return { value, label: entry?.label ?? value, path: [...parent, value] };
  });
}

/** One folder on the way to a place, as a filter row the Database view can change. */
export interface PlaceFilter {
  /** The level's column, named: "Person", "Created". */
  column: string;
  /** The folder's value here ("" for "No Person"). */
  value: string;
  /** The place this step leads to. */
  path: string[];
  /** The folders at this level, to move to instead: "empty" for the no-value one. */
  options: { value: string; label: string }[];
  /** The folder as filter conditions, all of which hold for the files in it (a rule's When). */
  conditions: FilterRule[];
}

/**
 * Where opening a folder lands with single folders skipped: on through each
 * folder that holds just one folder and no files, which would only be a step
 * (each folder `skips` allows: its level skips them, or the whole view does).
 */
export function skipSingles(tree: FolderTree, path: string[], skips: (folder: string[]) => boolean = () => true): string[] {
  let at = path;
  for (;;) {
    const { folders, files } = tree.contents(at);
    if (folders.length !== 1 || files.length > 0 || !skips(at)) return at;
    at = [...at, folders[0].value];
  }
}

/** Up from a place with single folders skipped: past each folder holding just the one folder, which would open straight back. */
export function enclosingPlace(tree: FolderTree, place: string[], skips: (folder: string[]) => boolean = () => true): string[] {
  let at = place.slice(0, -1);
  while (at.length > 0) {
    const { folders, files } = tree.contents(at);
    if (folders.length !== 1 || files.length > 0 || !skips(at)) break;
    at = at.slice(0, -1);
  }
  return at;
}

/** A place as filter rows, one per folder: "Person is Josh", "Created is March 2024", "Person is empty". */
export function placeFilters(
  tree: FolderTree,
  root: FolderLevel | null,
  place: string[],
  kindOf: (column: string) => ColumnKind,
  now: Date = new Date()
): PlaceFilter[] {
  return place.map((value, i) => {
    const parent = place.slice(0, i);
    const level = levelAt(root, parent);
    return {
      column: level ? folderColumnLabel(level.column) : "Folder",
      value,
      path: [...parent, value],
      options: tree.contents(parent).folders.map((f) => ({ value: f.value, label: f.value === NO_VALUE ? "empty" : f.label })),
      conditions: level ? folderConditions(level.column, value, kindOf(level.column), now, level.dateUnit) : [],
    };
  });
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The conditions that pick out a folder's files at a level, as folderKeys
 * files them: "Person is Josh", "Tags has Rent", a month or one of Finder's
 * date or size buckets as a range, "is empty" for the No-value folder. Empty
 * when the folder has no such conditions (a date property's unreadable text).
 */
export function folderConditions(column: string, value: string, kind: ColumnKind, now: Date, unit?: DateUnit): FilterRule[] {
  const rule = (op: FilterOp, v: string): FilterRule => ({ ...newRule(column, kind), op, value: v });
  if (value === NO_VALUE) return [rule("empty", "")];
  // Days as [first, end): after the day before the first, and before the end
  const days = (from: Date, end: Date | null) => [
    rule("after", ymd(new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1))),
    ...(end ? [rule("before", ymd(end))] : []),
  ];
  // A date by a chosen unit: the days its folder spans (none for one that repeats, as March of every year)
  if (unit && unit !== "relative" && (kind === "date" || column === "created" || column === "modified")) {
    const range = dateFolderRange(value, unit);
    return range ? days(...range) : [];
  }
  if (column === "created" || column === "modified") {
    const range = dateGroupRange(value, now);
    return range ? days(...range) : [];
  }
  if (column === "size") {
    const range = sizeGroupRange(value);
    return range ? [rule("gte", String(range[0])), ...(range[1] != null ? [rule("lt", String(range[1]))] : [])] : [];
  }
  switch (kind) {
    case "date": {
      const month = /^(\d{4})-(\d{2})$/.exec(value);
      if (!month) return [];
      const [year, m] = [Number(month[1]), Number(month[2]) - 1];
      return days(new Date(year, m, 1), new Date(year, m + 1, 1));
    }
    case "number":
      return [rule("eq", value)];
    case "list":
      return [rule("has", value)];
    default:
      return [rule("is", value)];
  }
}

/** The levels below a place, as they usually run (branches aside): what the folders there are made of. */
export function levelsBelow(root: FolderLevel | null, place: string[]): FolderLevel[] {
  const levels: FolderLevel[] = [];
  for (let level = levelAt(root, place); level; level = level.next) levels.push(level);
  return levels;
}

/** Folder levels whose folders are relative or bucketed (Today, Previous 7 Days; 1 to 10 MB): no filter picks them exactly. */
const UNFILTERABLE = new Set(["size", "name", "path"]);

/**
 * A place as the view filters that pick its files (step 4: New View from
 * Folder): Person is Josh, Project has Apollo, Due within March 2024, Person
 * is empty. Null when a level's folders can't be filtered for exactly
 * (Finder's relative date and size buckets); callers check the result
 * against the folder's files too, as scoped properties can still differ.
 */
export function placeFilterRules(root: FolderLevel | null, place: string[], reader: ValueReader): FilterRule[] | null {
  const rules: FilterRule[] = [];
  for (let i = 0; i < place.length; i++) {
    const level = levelAt(root, place.slice(0, i));
    if (!level || UNFILTERABLE.has(level.column)) return null;
    const column = level.column;
    const native = column === "created" || column === "modified";
    const value = place[i];
    const rule = (op: FilterRule["op"], v = value): FilterRule => ({ id: `place-${i}-${rules.length}`, column, op, value: v });
    if (value === NO_VALUE) {
      rules.push(rule("empty", ""));
      continue;
    }
    if (native || reader.kindOf(column) === "date") {
      // The days the folder spans: not for Finder's relative buckets, nor a unit that repeats (March of every year)
      const range = dateFolderRange(value, level.dateUnit ?? defaultDateUnit(column));
      if (!range) return null;
      const [first, end] = range;
      rules.push(rule("after", ymd(new Date(first.getFullYear(), first.getMonth(), first.getDate() - 1))), rule("before", ymd(end)));
      continue;
    }
    switch (reader.kindOf(column)) {
      case "list":
        rules.push(rule("has"));
        break;
      case "number":
        rules.push(rule("eq"));
        break;
      default:
        rules.push(rule("is"));
    }
  }
  return rules;
}

/** A folder group's id: its place, apart from the Database view's own group ids. */
export const folderGroupId = (path: string[]) => `folder:${JSON.stringify(path)}`;

/** The place a folder group stands for (null for any other group). */
export function folderGroupPath(id: string): string[] | null {
  if (!id.startsWith("folder:")) return null;
  try {
    const path: unknown = JSON.parse(id.slice("folder:".length));
    return Array.isArray(path) ? path.map(String) : null;
  } catch {
    return null;
  }
}

/**
 * The folders below a place as the Database view's groups: a group per
 * folder, nested level by level, holding its files in the order given. A
 * file in several folders (a Multi-select) is in each. Files sitting beside
 * the folders at a level go in a last "Other Files" group. Null when the place
 * holds only files.
 */
export function folderGroups(tree: FolderTree, place: string[]): RowGroup<FileRecord>[] | null {
  const build = (path: string[], depth: number): RowGroup<FileRecord>[] => {
    const { folders, files } = tree.contents(path);
    const groups = folders.map((entry): RowGroup<FileRecord> => {
      const inner = [...path, entry.value];
      return {
        id: folderGroupId(inner),
        label: entry.label,
        depth,
        count: entry.count,
        rows: tree.filesAt(inner),
        children: build(inner, depth + 1),
      };
    });
    if (groups.length > 0 && files.length > 0) {
      groups.push({ id: `${folderGroupId(path)}:other`, label: "Other Files", depth, count: files.length, rows: files, children: [] });
    }
    return groups;
  };
  const groups = build(place, 0);
  return groups.length > 0 ? groups : null;
}

// ── The structure (editing it: lib/hierarchy) ───────────────────────

export function sameFolderLevel(a: FolderLevel | null, b: FolderLevel | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.column !== b.column || a.direction !== b.direction || !sameFolderLevel(a.next, b.next)) return false;
  if (a.noValue !== b.noValue || a.allValues !== b.allValues || a.dateUnit !== b.dateUnit || a.skipSingle !== b.skipSingle) return false;
  const keys = Object.keys(a.branches);
  return (
    keys.length === Object.keys(b.branches).length &&
    keys.every((k) => Object.prototype.hasOwnProperty.call(b.branches, k) && sameFolderLevel(a.branches[k], b.branches[k]))
  );
}

/** The order a new level of a column starts in: newest and largest first for dates and sizes, as Finder groups them. */
export function defaultDirection(column: string, typeOf: (name: string) => ValueType): "asc" | "desc" {
  if (column === "created" || column === "modified" || column === "size") return "desc";
  return column.startsWith(PROP_PREFIX) && typeOf(propName(column)) === "date" ? "desc" : "asc";
}

/** The Database view's grouping levels as a starting hierarchy. */
export function seedFromGroups(groups: GroupLevel[]): FolderLevel | null {
  return groups.reduceRight<FolderLevel | null>(
    (next, g) => ({ column: g.key, direction: g.direction, next, branches: {} }),
    null
  );
}
