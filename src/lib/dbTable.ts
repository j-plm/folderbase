import { compareSortValues, type SortState } from "./columns";
import { dateTimeKey, listValues, parseNumber } from "./propertyTypes";
import { compilePattern, isPatternError, matchPattern, type CompiledPattern } from "./patterns";

// Filter rules and multi-key sorting for the database view. Pure: the view
// supplies how to read a column's value and what kind of column it is.

export type ColumnKind = "text" | "number" | "date" | "list";

export type FilterOp =
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "matches"
  | "is"
  | "is_not"
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "before"
  | "after"
  | "has"
  | "has_not"
  | "empty"
  | "not_empty";

export interface FilterRule {
  id: string;
  column: string;
  op: FilterOp;
  value: string;
  /**
   * For "matches pattern" on a list (Path Tags, a Multi-select): which item
   * is tried. "first", "last" or "n:2" (the 2nd); missing or "any": any item.
   * For Path Tags, top folder first, so "last" is the folder the file is in.
   */
  item?: string;
}

/** The items of a list a rule looks at: one of them ("first", "last", "n:2"), or all ("any"). */
export function listItems(items: string[], item: string | undefined): string[] {
  if (!item || item === "any" || item === "all") return items;
  const at = item === "first" ? 0 : item === "last" ? items.length - 1 : Number(item.slice(2)) - 1;
  return at >= 0 && at < items.length ? [items[at]] : [];
}

/** How a list of filters combines: And (all hold) or Or (any one does). */
export type FilterMatch = "all" | "any";

/**
 * Filters in brackets, with their own And/Or: "Client is Acme And (Tags has
 * Rent Or Tags has Bills)". Groups can hold groups (see filterTree.ts).
 */
export interface FilterGroup {
  id: string;
  match: FilterMatch;
  items: FilterItem[];
}

/** One entry of a filter list: a filter, or a group of them. */
export type FilterItem = FilterRule | FilterGroup;

export function isFilterGroup(item: FilterItem): item is FilterGroup {
  return Array.isArray((item as FilterGroup).items);
}

/** A filter that has what it needs to narrow anything (a value, unless it's "is empty"). */
export function isActiveRule(rule: FilterRule): boolean {
  return !opNeedsValue(rule.op) || rule.value.trim() !== "";
}

/**
 * Whether `items`, combined by `match`, hold for a row; `test` says whether one
 * filter does. Filters still waiting for a value, and groups of only those, are
 * left out, so a half-made Or doesn't let everything through. Null: nothing to test.
 */
export function evalFilters(items: FilterItem[], match: FilterMatch, test: (rule: FilterRule) => boolean): boolean | null {
  let tested = false;
  for (const item of items) {
    const result = isFilterGroup(item) ? evalFilters(item.items, item.match, test) : isActiveRule(item) ? test(item) : null;
    if (result == null) continue;
    tested = true;
    if (match === "all" && !result) return false;
    if (match === "any" && result) return true;
  }
  return tested ? match === "all" : null;
}

export const FILTER_OPS: Record<ColumnKind, { op: FilterOp; label: string }[]> = {
  text: [
    { op: "contains", label: "contains" },
    { op: "not_contains", label: "does not contain" },
    { op: "starts_with", label: "starts with" },
    { op: "ends_with", label: "ends with" },
    { op: "matches", label: "matches pattern" },
    { op: "is", label: "is" },
    { op: "is_not", label: "is not" },
    { op: "empty", label: "is empty" },
    { op: "not_empty", label: "is not empty" },
  ],
  number: [
    { op: "eq", label: "=" },
    { op: "neq", label: "≠" },
    { op: "gt", label: ">" },
    { op: "lt", label: "<" },
    { op: "gte", label: "≥" },
    { op: "lte", label: "≤" },
    { op: "matches", label: "matches pattern" },
    { op: "empty", label: "is empty" },
    { op: "not_empty", label: "is not empty" },
  ],
  date: [
    { op: "is", label: "is" },
    { op: "before", label: "is before" },
    { op: "after", label: "is after" },
    { op: "matches", label: "matches pattern" },
    { op: "empty", label: "is empty" },
    { op: "not_empty", label: "is not empty" },
  ],
  list: [
    { op: "has", label: "has" },
    { op: "has_not", label: "does not have" },
    { op: "matches", label: "matches pattern" },
    { op: "empty", label: "is empty" },
    { op: "not_empty", label: "is not empty" },
  ],
};

/** Conditions that don't take a value. */
export function opNeedsValue(op: FilterOp): boolean {
  return op !== "empty" && op !== "not_empty";
}

function isEmpty(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseNumber(value);
  return null;
}

/** Whether `value` (a cell's stored value) satisfies `rule`. Rules without a value yet match everything. */
export function matchesRule(value: unknown, kind: ColumnKind, rule: FilterRule): boolean {
  if (rule.op === "empty") return isEmpty(value);
  if (rule.op === "not_empty") return !isEmpty(value);
  const target = rule.value.trim();
  if (target === "") return true;
  // A pattern can be tried on any column: on a list, any one of its items fitting is enough
  if (rule.op === "matches") {
    const pattern = patternFor(target);
    return pattern != null && patternSlots(pattern, value, rule.item) != null;
  }

  switch (kind) {
    case "number": {
      const a = asNumber(value);
      const b = parseNumber(target);
      if (b == null) return true;
      if (a == null) return rule.op === "neq";
      switch (rule.op) {
        case "eq": return a === b;
        case "neq": return a !== b;
        case "gt": return a > b;
        case "lt": return a < b;
        case "gte": return a >= b;
        case "lte": return a <= b;
        default: return true;
      }
    }
    case "date": {
      let a = dateTimeKey(value);
      let b = dateTimeKey(target);
      if (b == null) return true;
      if (a == null) return false;
      // Times count only when both have one: "is 1 March" is the whole day
      if (a.length !== b.length) {
        a = a.slice(0, 10);
        b = b.slice(0, 10);
      }
      switch (rule.op) {
        case "is": return a === b;
        case "before": return a < b;
        case "after": return a > b;
        default: return true;
      }
    }
    case "list": {
      const has = listValues(value).some((v) => v.toLowerCase() === target.toLowerCase());
      return rule.op === "has_not" ? !has : has;
    }
    default: {
      const a = (Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value)).toLowerCase();
      const b = target.toLowerCase();
      switch (rule.op) {
        case "contains": return a.includes(b);
        case "starts_with": return a.startsWith(b);
        case "ends_with": return a.endsWith(b);
        case "not_contains": return !a.includes(b);
        case "is": return a === b;
        case "is_not": return a !== b;
        default: return true;
      }
    }
  }
}

/**
 * The slots a column's value fills: its text, or for a list (Path Tags, a
 * Multi-select) the first item that fits. Null if nothing fits.
 */
export function patternSlots(pattern: CompiledPattern, value: unknown, item?: string): Record<string, string> | null {
  return patternMatch(pattern, value, item)?.slots ?? null;
}

/** As patternSlots, with the text that fitted (which folder, for a list). */
export function patternMatch(
  pattern: CompiledPattern,
  value: unknown,
  item?: string
): { text: string; slots: Record<string, string> } | null {
  const all = (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]).map((v) =>
    typeof v === "string" ? v : String(v)
  );
  // A list can be narrowed to one item (the folder the file is in, the top folder…)
  for (const text of Array.isArray(value) ? listItems(all, item) : all) {
    const found = matchPattern(pattern, text);
    if (found) return { text, slots: found };
  }
  return null;
}

const patternCache = new Map<string, CompiledPattern | null>();
/** A "matches pattern" rule's compiled pattern (null if it has a mistake), kept between rows. */
export function patternFor(text: string): CompiledPattern | null {
  let p = patternCache.get(text);
  if (p === undefined) {
    const c = compilePattern(text);
    p = isPatternError(c) ? null : c;
    if (patternCache.size > 200) patternCache.clear();
    patternCache.set(text, p);
  }
  return p;
}

/** Rows passing `items` combined by `match` (groups by their own). No filters keeps every row. */
export function applyFilters<T>(
  rows: T[],
  items: FilterItem[],
  match: FilterMatch,
  getValue: (row: T, column: string) => unknown,
  kindOf: (column: string) => ColumnKind
): T[] {
  if (items.length === 0) return rows;
  return rows.filter(
    (row) => evalFilters(items, match, (rule) => matchesRule(getValue(row, rule.column), kindOf(rule.column), rule)) !== false
  );
}

/** Sorted by each key in turn; ties keep their order. Empty values sort last. */
export function multiSort<T>(
  rows: T[],
  sorts: SortState[],
  getValue: (row: T, column: string) => string | number | null | undefined
): T[] {
  if (sorts.length === 0) return rows;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const s of sorts) {
        const c = compareSortValues(getValue(a.row, s.key), getValue(b.row, s.key), s.direction);
        if (c !== 0) return c;
      }
      return a.index - b.index;
    })
    .map((x) => x.row);
}

/** A rule for `column` with the first condition its kind offers. */
export function newRule(column: string, kind: ColumnKind): FilterRule {
  return { id: Math.random().toString(36).slice(2), column, op: FILTER_OPS[kind][0].op, value: "" };
}

/** The rule's condition if `kind` offers it, else the kind's first condition (after the column changes). */
export function fitRule(rule: FilterRule, kind: ColumnKind): FilterRule {
  return FILTER_OPS[kind].some((o) => o.op === rule.op) ? rule : { ...rule, op: FILTER_OPS[kind][0].op };
}

/**
 * Clicking a column header: ascending, then descending, then unsorted. Sorting
 * by a new column replaces any multi-level sort.
 */
export function cycleSort(sorts: SortState[], key: string): SortState[] {
  const current = sorts.length === 1 && sorts[0].key === key ? sorts[0].direction : null;
  if (current === "asc") return [{ key, direction: "desc" }];
  if (current === "desc") return [];
  return [{ key, direction: "asc" }];
}
