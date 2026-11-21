import { FILTER_OPS, applyFilters, isActiveRule, isFilterGroup, matchesRule, type FilterItem, type FilterMatch, type FilterRule } from "./dbTable";
import { PROP_PREFIX, propName } from "./fileColumns";
import { impliedByFile, isEmptyValue, valueReader } from "./fileValues";
import { columnGroup } from "./propertyGroups";
import { listValues, parseNumber, propertyLabel, valueToText } from "./propertyTypes";
import type { Scope } from "./scopes";
import type { CellEdit } from "./commands";
import type { FileRecord, ValueType } from "../types";

// Dropping files on the sidebar (spec ▸ Multi-folder Presence ▸ Dropping on
// the sidebar). Pure, so the confirmation sheet can say what a drop will do:
//
// - On a view: the files get the values its own filters name (not its
//   Hierarchy's folders). Only a filter that names one value gives it: "is" on
//   a Select, Text or Date, "=" on a Number, "has" on a Multi-select (added).
//   The rest are listed, with how many files they still leave out of the view
// - On another location: the files are copied there with their custom values

/** A value a view's filter gives: "Client is Acme". */
export interface FilterValue {
  column: string;
  value: string;
}

/** How a view's filters split into values that can be given and filters that can't. */
export interface FilterValues {
  values: FilterValue[];
  /** Filters that name no one value, as they read ("Kind is PDF", "Due is before 2024-03-01"). */
  unmet: string[];
}

export interface ValueSource {
  typeOf: (name: string) => ValueType;
  scopes: Scope[];
  /** A column, named ("Client", "Kind"). */
  label: (column: string) => string;
}

const kindOfType = (type: ValueType) => (type === "array" ? "list" : type === "number" ? "number" : type === "date" ? "date" : "text");

/** A filter as it reads: "Client is Acme". */
function describeRule(rule: FilterRule, src: ValueSource): string {
  const type = rule.column.startsWith(PROP_PREFIX) ? src.typeOf(propName(rule.column)) : null;
  const ops = Object.values(FILTER_OPS).flat();
  const op = (type ? FILTER_OPS[kindOfType(type)] : ops).find((o) => o.op === rule.op)?.label ?? ops.find((o) => o.op === rule.op)?.label ?? rule.op;
  return [src.label(rule.column), op, rule.value.trim()].filter(Boolean).join(" ");
}

/** The one value a filter names, if it can be given to a file. */
function settable(rule: FilterRule, src: ValueSource): FilterValue | null {
  if (!rule.column.startsWith(PROP_PREFIX)) return null;
  const name = propName(rule.column);
  if (columnGroup(name, true) !== "custom") return null;
  const value = rule.value.trim();
  if (!value) return null;
  const type = src.typeOf(name);
  const ok =
    type === "array" ? rule.op === "has" : type === "number" ? rule.op === "eq" && parseNumber(value) != null : rule.op === "is";
  return ok ? { column: rule.column, value } : null;
}

/**
 * The values a view's filters give, and those that give none. Filters joined
 * by And give theirs; a group or list joined by Or gives none (no one of its
 * filters is the one to choose), unless it holds only one.
 */
export function filterValues(items: FilterItem[], match: FilterMatch, src: ValueSource): FilterValues {
  const out: FilterValues = { values: [], unmet: [] };
  const walk = (list: FilterItem[], how: FilterMatch) => {
    const active = list.filter((i) => (isFilterGroup(i) ? hasActive(i.items) : isActiveRule(i)));
    if (how === "any" && active.length > 1) {
      out.unmet.push(`any of ${active.map((i) => (isFilterGroup(i) ? "a group" : describeRule(i, src))).join(", ")}`);
      return;
    }
    for (const item of active) {
      if (isFilterGroup(item)) {
        walk(item.items, item.match);
        continue;
      }
      const v = settable(item, src);
      const type = src.typeOf(propName(item.column));
      // A property with one value can't take two
      const clash = v && type !== "array" && out.values.some((o) => o.column === v.column && o.value.toLowerCase() !== v.value.toLowerCase());
      if (v && !clash) {
        if (!out.values.some((o) => o.column === v.column && o.value.toLowerCase() === v.value.toLowerCase())) out.values.push(v);
      } else {
        out.unmet.push(describeRule(item, src));
      }
    }
  };
  walk(items, match);
  return out;
}

function hasActive(items: FilterItem[]): boolean {
  return items.some((i) => (isFilterGroup(i) ? hasActive(i.items) : isActiveRule(i)));
}

/** What dropping files on a view would do. */
export interface ViewDropPlan {
  edits: CellEdit[];
  /** The values `edits` write over, for undo. */
  before: CellEdit[];
  /** How many files change. */
  files: number;
  /** Each value given, with what happens: "Client: Acme (3 set, 1 replaced)". */
  lines: string[];
  /** Filters that give no value. */
  unmet: string[];
  /** Files still left out of the view afterwards (by the unmet filters). */
  hidden: number;
}

/** The values dropping `files` on a view with these filters gives them. */
export function planViewDrop(files: FileRecord[], items: FilterItem[], match: FilterMatch, src: ValueSource): ViewDropPlan {
  const { values, unmet } = filterValues(items, match, src);
  const isList = (p: string) => src.typeOf(p) === "array";
  const reader = valueReader({ typeOf: src.typeOf, scopes: src.scopes, implied: impliedByFile(files, src.scopes, isList) });

  const edits: CellEdit[] = [];
  const before: CellEdit[] = [];
  const counts = new Map<FilterValue, { set: number; added: number; replaced: number }>();
  const sims: FileRecord[] = [];
  let changed = 0;
  for (const file of files) {
    const old = (file.metadata as Record<string, unknown> | null) ?? {};
    const meta: Record<string, unknown> = { ...old };
    for (const v of values) {
      const name = propName(v.column);
      const type = src.typeOf(name);
      const rule: FilterRule = { id: "", column: v.column, op: type === "array" ? "has" : type === "number" ? "eq" : "is", value: v.value };
      if (matchesRule(reader.columnValue({ ...file, metadata: meta }, v.column), kindOfType(type), rule)) continue;
      const c = counts.get(v) ?? { set: 0, added: 0, replaced: 0 };
      counts.set(v, c);
      const stored = meta[name];
      if (type === "array") {
        const list = listValues(stored).map(valueToText);
        meta[name] = [...list, v.value];
        if (list.length > 0) c.added++;
        else c.set++;
      } else {
        if (isEmptyValue(stored)) c.set++;
        else c.replaced++;
        meta[name] = type === "number" ? parseNumber(v.value) : v.value;
      }
    }
    let touched = false;
    for (const key of Object.keys(meta)) {
      if (JSON.stringify(meta[key] ?? null) === JSON.stringify(old[key] ?? null)) continue;
      edits.push({ file_id: file.file_id, key, value: meta[key] });
      before.push({ file_id: file.file_id, key, value: old[key] ?? null });
      touched = true;
    }
    if (touched) changed++;
    sims.push({ ...file, metadata: meta });
  }

  const simReader = valueReader({ typeOf: src.typeOf, scopes: src.scopes, implied: impliedByFile(sims, src.scopes, isList) });
  const shown = applyFilters(sims, items, match, simReader.columnValue, simReader.kindOf).length;

  const lines = values.map((v) => {
    const c = counts.get(v);
    const what = c
      ? [c.set && `${c.set} set`, c.added && `${c.added} added`, c.replaced && `${c.replaced} replaced`].filter(Boolean).join(", ")
      : "";
    return `${src.label(v.column)}: ${v.value} (${what || "already set"})`;
  });
  return { edits, before, files: changed, lines, unmet, hidden: sims.length - shown };
}

/**
 * The custom values that go with files copied to another location, by
 * property: "Client: Acme, Globex". Values read from the file aren't listed;
 * the copy reads its own.
 */
export function carriedValues(files: FileRecord[], typeOf: (name: string) => ValueType): string[] {
  const byName = new Map<string, Set<string>>();
  for (const file of files) {
    for (const [key, value] of Object.entries((file.metadata as Record<string, unknown> | null) ?? {})) {
      if (isEmptyValue(value) || columnGroup(key, true) !== "custom") continue;
      const set = byName.get(key) ?? new Set<string>();
      for (const v of typeOf(key) === "array" ? listValues(value) : [value]) set.add(valueToText(v));
      byName.set(key, set);
    }
  }
  const MAX = 4;
  return [...byName].map(([key, set]) => {
    const all = [...set];
    const shown = all.slice(0, MAX).join(", ");
    return `${propertyLabel(key)}: ${all.length > MAX ? `${shown} and ${all.length - MAX} more` : shown}`;
  });
}
