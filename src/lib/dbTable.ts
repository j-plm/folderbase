import { compareSortValues, type SortState } from "./columns";
import { dateKey, listValues, parseNumber } from "./propertyTypes";
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
}

export type FilterMatch = "all" | "any";

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
    { op: "empty", label: "is empty" },
    { op: "not_empty", label: "is not empty" },
  ],
  date: [
    { op: "is", label: "is" },
    { op: "before", label: "is before" },
    { op: "after", label: "is after" },
    { op: "empty", label: "is empty" },
    { op: "not_empty", label: "is not empty" },
  ],
  list: [
    { op: "has", label: "has" },
    { op: "has_not", label: "does not have" },
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
      const a = dateKey(value);
      const b = dateKey(target);
      if (b == null) return true;
      if (a == null) return false;
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
        case "matches": {
          const pattern = patternFor(target);
          // A pattern with a mistake in it matches nothing (the editor shows the mistake)
          return pattern != null && matchPattern(pattern, Array.isArray(value) ? value.join(", ") : String(value ?? "")) != null;
        }
        case "not_contains": return !a.includes(b);
        case "is": return a === b;
        case "is_not": return a !== b;
        default: return true;
      }
    }
  }
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

/** Rows passing all (or any) of `rules`. No rules keeps every row. */
export function applyFilters<T>(
  rows: T[],
  rules: FilterRule[],
  match: FilterMatch,
  getValue: (row: T, column: string) => unknown,
  kindOf: (column: string) => ColumnKind
): T[] {
  if (rules.length === 0) return rows;
  return rows.filter((row) => {
    const test = (rule: FilterRule) => matchesRule(getValue(row, rule.column), kindOf(rule.column), rule);
    return match === "all" ? rules.every(test) : rules.some(test);
  });
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
