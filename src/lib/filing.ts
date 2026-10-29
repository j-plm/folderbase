import { applyFilters, type FilterItem, type FilterMatch } from "./dbTable";
import { PROP_PREFIX, propName } from "./fileColumns";
import { impliedByFile, isEmptyValue, valueReader, type ValueReader } from "./fileValues";
import { NO_VALUE, folderKeys, folderTree, levelAt, type FolderTree } from "./folderTree";
import { dateFolderRange, defaultDateUnit } from "./dateFolders";
import { listValues, valueToText } from "./propertyTypes";
import type { Scope } from "./scopes";
import type { FolderLevel } from "./tableViews";
import type { CellEdit } from "./commands";
import type { FileRecord, ValueType } from "../types";

// Filing by drag (spec ▸ Multi-folder Presence): dropping files into a
// virtual folder gives them the values on its path. Pure, so the drag can say
// what a drop would change before anything is written.
//
// - A drop only takes away the value of the folder a file was dragged out of;
//   values not visible from there are never lost without asking (`replacements`)
// - A Multi-select gains the folder's value; dragged out of a sibling folder it
//   swaps that one value, unless Option is held (`add`)
// - Levels read from the file (Kind, Created, Path Tags) can't be set by a
//   drop: files that can't end up in the folder are left as they are, and the
//   drop says why. A date property's folder sets its day, or asks which one
//   when it spans several (`asks`)

/** What's being dragged: files (from the folder they're shown in) or folders (their files). */
export type DragItem =
  | {
      kind: "file";
      file: FileRecord;
      /** The folder it was dragged out of (null: from elsewhere, as another app). */
      from: string[] | null;
    }
  | { kind: "folder"; path: string[] };

export type Outcome = "fill" | "move" | "add" | "replace" | "remove";

/** A value a drop would write over that the user couldn't see from where they dragged. */
export interface Replacement {
  fileId: string;
  /** The level's name: "Client". */
  level: string;
  was: string;
  now: string;
}

/** A date level whose folder spans several days: the drop asks which one. */
export interface DateAsk {
  column: string;
  /** The level's name: "Due". */
  level: string;
  /** The folder's name: "March 2024". */
  folder: string;
  /** Its first and last day ("2024-03-01", "2024-03-31"). */
  first: string;
  last: string;
}

export interface DropPlan {
  /** Why nothing can be dropped here; null when something can (or nothing would change). */
  refusal: string | null;
  edits: CellEdit[];
  /** The values `edits` write over, to put back on undo. */
  before: CellEdit[];
  /** How many files change. */
  files: number;
  /** Files left as they are, and why (the first reason met). */
  left: { count: number; reason: string } | null;
  /** Values written over that weren't visible from the drag: the drop asks first. */
  replacements: Replacement[];
  /** Dates to choose before filing (the first day stands in until then). */
  asks: DateAsk[];
  /** Beside the cursor: "Move to “Hermes”", "Add to “Hermes”", "Set Project to Hermes". */
  title: string;
  /** Along the bottom of the window: each level's change, then what's left out. */
  details: string[];
  /** For Undo ("Undo Move"). */
  verb: "Move" | "Add" | "Set";
}

export interface DropContext {
  /** The view's folders as shown. */
  tree: FolderTree;
  root: FolderLevel | null;
  typeOf: (name: string) => ValueType;
  scopes: Scope[];
  /** The view's filters: a file they leave out wouldn't show in any folder. */
  filters: FilterItem[];
  match: FilterMatch;
  /** A level's column, named ("Client", "Kind"). */
  label: (column: string) => string;
  /** The view's top, named (the location or view). */
  topLabel: string;
}

export interface DropOptions {
  /** Option held: a Multi-select gains the folder's value and keeps the one it was dragged from. */
  add?: boolean;
  /** Off (Keep Existing): files whose value would be replaced are left as they are. On by default. */
  replace?: boolean;
  /** Files that can't show in the folder still get the values that can be set (files just added from outside). */
  partial?: boolean;
  /** The day chosen for a date level's folder, by column ("2024-03-12"). */
  dates?: Record<string, string>;
}

/** Nothing to do: dropping where the files already are. */
const NOTHING = (verb: DropPlan["verb"] = "Move"): DropPlan => ({
  refusal: null,
  edits: [],
  before: [],
  files: 0,
  left: null,
  replacements: [],
  asks: [],
  title: "",
  details: [],
  verb,
});

const startsWith = (path: string[], prefix: string[]) =>
  prefix.length <= path.length && prefix.every((v, i) => path[i] === v);

/** The value of the folder at `column` on a path, if the path passes through that level. */
function valueOnPath(root: FolderLevel | null, path: string[] | null, column: string): string | undefined {
  if (!path) return undefined;
  for (let i = 0; i < path.length; i++) {
    if (levelAt(root, path.slice(0, i))?.column === column) return path[i];
  }
  return undefined;
}

/** A folder's name as it shows ("Hermes", "March 2024", "No Client"). */
export function folderLabel(tree: FolderTree, path: string[], topLabel: string): string {
  if (path.length === 0) return topLabel;
  const value = path[path.length - 1];
  return tree.contents(path.slice(0, -1)).folders.find((f) => f.value === value)?.label ?? value;
}

const sameText = (a: unknown, b: string) => valueToText(a) === b;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface LevelResult {
  column: string;
  outcome: Outcome;
  replaced?: Replacement;
  asks?: Omit<DateAsk, "folder">;
}

/** One file's new values for a drop, or why it can't go there. */
function refile(
  file: FileRecord,
  from: string[] | null,
  to: string[],
  ctx: DropContext,
  reader: ValueReader,
  opts: DropOptions
): { meta: Record<string, unknown>; results: LevelResult[]; blocked: string | null } {
  const meta: Record<string, unknown> = { ...((file.metadata as Record<string, unknown> | null) ?? {}) };
  const results: LevelResult[] = [];

  // Dragged up to a folder it's inside: out of each folder below that one, where the value can be taken away
  if (from && to.length < from.length && startsWith(from, to)) {
    for (let i = to.length; i < from.length; i++) {
      const level = levelAt(ctx.root, from.slice(0, i));
      if (!level?.column.startsWith(PROP_PREFIX) || from[i] === NO_VALUE) continue;
      const name = propName(level.column);
      const type = ctx.typeOf(name);
      if (type === "date") continue;
      const stored = meta[name];
      if (type === "array") {
        const kept = listValues(stored).filter((v) => v !== from[i]);
        if (kept.length === listValues(stored).length) continue;
        meta[name] = kept.length > 0 ? kept : null;
      } else {
        if (!sameText(stored, from[i])) continue;
        meta[name] = null;
      }
      results.push({ column: level.column, outcome: "remove" });
    }
    return { meta, results, blocked: null };
  }

  for (let i = 0; i < to.length; i++) {
    const level = levelAt(ctx.root, to.slice(0, i));
    if (!level) break;
    const value = to[i];
    const column = level.column;
    const name = ctx.label(column);
    const keys = folderKeys(file, column, reader, ctx.typeOf, level.dateUnit);
    const already = keys ? keys.some((k) => k.value === value) : value === NO_VALUE;

    // Read from the file: only files already there can go in
    if (!column.startsWith(PROP_PREFIX)) {
      if (already) continue;
      return { meta, results, blocked: column === "tags" ? "Path Tags are read from the disk" : `${name} is read from the file` };
    }

    const prop = propName(column);
    const type = ctx.typeOf(prop);
    const stored = meta[prop];
    const source = valueOnPath(ctx.root, from, column);
    const moving = !opts.add && source !== undefined && source !== value;

    // A date's folder: its day, or the one chosen for a folder of several days
    if (type === "date" && value !== NO_VALUE) {
      if (already) continue;
      const range = dateFolderRange(value, level.dateUnit ?? defaultDateUnit(column));
      // A month of every year, say: no one day to give
      if (!range) return { meta, results, blocked: `${name} is a date: set it in the Database view` };
      const first = ymd(range[0]);
      const last = ymd(new Date(range[1].getFullYear(), range[1].getMonth(), range[1].getDate() - 1));
      const chosen = opts.dates?.[column];
      const asks = first === last || (chosen && chosen >= first && chosen <= last) ? undefined : { column, level: name, first, last };
      const visible = source !== undefined && !!keys?.some((k) => k.value === source);
      let outcome: Outcome = "fill";
      let replaced: Replacement | undefined;
      if (!isEmptyValue(stored)) {
        if (visible) outcome = "move";
        else if (opts.replace === false) return { meta, results, blocked: `already has a ${name}` };
        else {
          outcome = "replace";
          replaced = { fileId: file.file_id, level: name, was: valueToText(stored), now: chosen ?? first };
        }
      }
      meta[prop] = asks ? first : (chosen && chosen >= first && chosen <= last ? chosen : first);
      results.push({ column, outcome, replaced, asks });
      continue;
    }

    if (value === NO_VALUE) {
      // Into "No Client": every value goes, which is only visible if it's the one dragged from
      if (isEmptyValue(stored)) continue;
      const values = listValues(stored).map(valueToText);
      const hidden = values.filter((v) => v !== source);
      if (hidden.length > 0) {
        if (opts.replace === false) return { meta, results, blocked: `already has a ${name}` };
        results.push({ column, outcome: "replace", replaced: { fileId: file.file_id, level: name, was: hidden.join(", "), now: `No ${name}` } });
      } else {
        results.push({ column, outcome: "remove" });
      }
      meta[prop] = null;
      continue;
    }

    if (type === "array") {
      const list = listValues(stored).map(valueToText);
      const next = moving ? list.filter((v) => v !== source) : [...list];
      // Held only by implication counts as held
      if (!already && !next.includes(value)) next.push(value);
      if (next.length === list.length && next.every((v, j) => v === list[j])) continue;
      const swapped = moving && list.includes(source!);
      meta[prop] = next.length > 0 ? next : null;
      results.push({ column, outcome: swapped ? "move" : list.length === 0 ? "fill" : "add" });
      continue;
    }

    // One value (Select, Text, Number): it replaces whatever is there
    if (already) continue;
    const want = type === "number" ? Number(value) : value;
    if (isEmptyValue(stored)) {
      results.push({ column, outcome: "fill" });
    } else if (source !== undefined && sameText(stored, source)) {
      results.push({ column, outcome: "move" });
    } else {
      if (opts.replace === false) return { meta, results, blocked: `already has a ${name}` };
      results.push({ column, outcome: "replace", replaced: { fileId: file.file_id, level: name, was: valueToText(stored), now: value } });
    }
    meta[prop] = want;
  }
  return { meta, results, blocked: null };
}

const OUTCOME_WORDS: Record<Outcome, string> = { fill: "set", move: "moved", add: "added", replace: "replaced", remove: "taken out" };

/**
 * What dropping `items` into the folder at `to` would change: each file's new
 * values (as cell edits, with the old ones for undo), the values it would
 * write over, the files that can't go there and why, and how to describe it.
 */
export function planDrop(items: DragItem[], to: string[], ctx: DropContext, opts: DropOptions = {}): DropPlan {
  // Each file once, from the first item it's dragged with; a folder brings its files, from itself
  const sources = new Map<string, { file: FileRecord; from: string[] | null }>();
  for (const item of items) {
    if (item.kind === "folder") {
      if (startsWith(to, item.path)) {
        const name = folderLabel(ctx.tree, item.path, ctx.topLabel);
        return { ...NOTHING(), refusal: to.length === item.path.length ? null : `“${name}” can't go inside itself` };
      }
      for (const file of ctx.tree.filesAt(item.path)) {
        if (!sources.has(file.file_id)) sources.set(file.file_id, { file, from: item.path });
      }
    } else if (!sources.has(item.file.file_id)) {
      sources.set(item.file.file_id, { file: item.file, from: item.from });
    }
  }
  const all = [...sources.values()];
  const isList = (p: string) => ctx.typeOf(p) === "array";
  const reader = valueReader({ typeOf: ctx.typeOf, scopes: ctx.scopes, implied: impliedByFile(all.map((s) => s.file), ctx.scopes, isList) });

  const refiled = all.map((s) => ({ ...s, ...refile(s.file, s.from, to, ctx, reader, opts) }));
  const moved = refiled.filter((r) => !r.blocked && r.results.length > 0);

  // Would they show in the folder afterwards? Worked out as the view works out its folders
  const sims = moved.map((r) => ({ ...r.file, metadata: r.meta }));
  const simReader = valueReader({ typeOf: ctx.typeOf, scopes: ctx.scopes, implied: impliedByFile(sims, ctx.scopes, isList) });
  const kept = new Set(applyFilters(sims, ctx.filters, ctx.match, simReader.columnValue, simReader.kindOf).map((f) => f.file_id));
  const landed = new Set(
    folderTree(sims.filter((f) => kept.has(f.file_id)), ctx.root, simReader, ctx.typeOf, ctx.label)
      .filesAt(to)
      .map((f) => f.file_id)
  );
  const why = (fileId: string) => (kept.has(fileId) ? "its other values keep it out of this folder" : "the view's filters would leave it out");

  let leftCount = 0;
  let reason: string | null = null;
  const leave = (r: string) => {
    leftCount++;
    reason ??= r;
  };
  const applied: typeof moved = [];
  for (const r of refiled) {
    if (r.blocked) {
      leave(r.blocked);
      // Added from outside: they're here now whatever, so they take the values that can be set
      if (opts.partial && r.results.length > 0) applied.push(r);
    } else if (r.results.length === 0) {
      continue;
    } else if (!landed.has(r.file.file_id)) {
      leave(why(r.file.file_id));
      if (opts.partial) applied.push(r);
    } else {
      applied.push(r);
    }
  }

  const left = leftCount > 0 && reason ? { count: leftCount, reason } : null;
  const outcomes = applied.flatMap((r) => r.results);
  // Anything taken away is a move; otherwise values only gained are an add
  const verb: DropPlan["verb"] = outcomes.some((o) => o.outcome === "move" || o.outcome === "replace" || o.outcome === "remove")
    ? "Move"
    : outcomes.some((o) => o.outcome === "add")
      ? "Add"
      : "Set";
  if (applied.length === 0) {
    return { ...NOTHING(verb), refusal: left ? `Can't go here: ${left.reason}` : null };
  }

  // Each date level still to choose a day for, once
  const asks: DateAsk[] = [];
  for (const o of outcomes) {
    if (!o.asks || asks.some((a) => a.column === o.asks!.column)) continue;
    const step = to.findIndex((_, i) => levelAt(ctx.root, to.slice(0, i))?.column === o.asks!.column);
    asks.push({ ...o.asks, folder: folderLabel(ctx.tree, to.slice(0, step + 1), ctx.topLabel) });
  }

  const edits: CellEdit[] = [];
  const before: CellEdit[] = [];
  for (const r of applied) {
    const old = (r.file.metadata as Record<string, unknown> | null) ?? {};
    for (const key of new Set(r.results.map((x) => propName(x.column)))) {
      const now = r.meta[key];
      if (JSON.stringify(now ?? null) === JSON.stringify(old[key] ?? null)) continue;
      edits.push({ file_id: r.file.file_id, key, value: isEmptyValue(now) ? null : now });
      before.push({ file_id: r.file.file_id, key, value: old[key] ?? null });
    }
  }

  // Each level that changes, as "Project: Hermes · 3 set, 2 moved"
  const columns = [...new Set(outcomes.map((o) => o.column))];
  const target = folderLabel(ctx.tree, to, ctx.topLabel);
  const details = columns.map((column) => {
    const counts = new Map<Outcome, number>();
    for (const o of outcomes) if (o.column === column) counts.set(o.outcome, (counts.get(o.outcome) ?? 0) + 1);
    const step = to.findIndex((_, i) => levelAt(ctx.root, to.slice(0, i))?.column === column);
    const value = step >= 0 ? folderLabel(ctx.tree, to.slice(0, step + 1), ctx.topLabel) : null;
    const what = [...counts].map(([o, n]) => `${n} ${OUTCOME_WORDS[o]}`).join(", ");
    return `${ctx.label(column)}${value ? `: ${value}` : ""} (${what})`;
  });
  for (const a of asks) details.push(`${a.level}: asks which day`);
  if (left) details.push(`${left.count} can't go here: ${left.reason}`);

  const only = columns.length === 1 ? columns[0] : null;
  const title =
    verb === "Add"
      ? `Add to “${target}”`
      : verb === "Set" && only
        ? `Set ${ctx.label(only)} to ${target}`
        : `Move to “${target}”`;

  return {
    refusal: null,
    edits,
    before,
    files: applied.length,
    left,
    replacements: applied.flatMap((r) => r.results.flatMap((x) => (x.replaced ? [x.replaced] : []))),
    asks,
    title,
    details,
    verb,
  };
}
