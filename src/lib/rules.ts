import { listItems, matchesRule, newRule, patternFor, patternMatch, type ColumnKind, type FilterMatch, type FilterRule } from "./dbTable";
import { FormulaError, runFormula, type FormulaContext } from "./formula";
import { DATE_FORMATS, parseDateAs, type ExampleSlot } from "./patterns";
import { coerceValue, dateKey, listValues, parseNumber, valueToText } from "./propertyTypes";
import { NATIVE_LABELS, PROP_PREFIX, baseName, fileExtension, fileName, folderNames } from "./fileColumns";
import type { CellEdit } from "./commands";
import type { FileRecord, PropertyConfig, ValueType } from "../types";

// Rules: "when these conditions hold, set these values" (spec ▸ Rules).
// Pure: the caller says how to read columns and what the properties are, so
// the same code previews a rule in the editor and runs it in the background.

/** Where an action's value comes from: typed in, a slot of the rule's pattern, another column, or a formula. */
export type ActionMode = "fixed" | "slot" | "column" | "formula";

export interface RuleAction {
  id: string;
  property: string;
  mode: ActionMode;
  /** The fixed text, the slot's name, the column's id ("created", "tags", "prop:Client"), or the formula. */
  value: string;
  /**
   * For a column: which part of its value. A list (Source Tags, a Multi-select):
   * "all", "first", "last" or "n:2" (the 2nd). A date: "date", "year", "month",
   * "monthName", "yearMonth", "quarter" or "weekday". Missing: the whole value.
   */
  part?: string;
  /** How to read the text before writing it: "" as it is, "number", or a date format such as "YYMMDD". */
  format?: string;
  /** Write over an existing value (off: only empty values are filled; a Multi-select gains the value). */
  overwrite?: boolean;
}

export interface RuleDefinition {
  match: FilterMatch;
  conditions: FilterRule[];
  actions: RuleAction[];
  /**
   * The example slots were picked from, kept so the picks can be adjusted later:
   * its text, and the column it came from (Name if missing).
   */
  example?: { name: string; slots: ExampleSlot[]; column?: string; item?: string };
}

export interface StoredRule {
  rule_id: string;
  library: string;
  name: string;
  enabled: boolean;
  position: number;
  definition: string;
  created_at?: string;
  updated_at?: string;
}

/** A value a rule wrote: `value` is JSON (a value, or one item added to a list). */
export interface RuleWrite {
  rule_id: string;
  file_id: string;
  key: string;
  value: string;
}

export const newAction = (property = ""): RuleAction => ({
  id: Math.random().toString(36).slice(2),
  property,
  mode: "fixed",
  value: "",
});

export function emptyDefinition(): RuleDefinition {
  return { match: "all", conditions: [], actions: [newAction()] };
}

/** A stored definition, with anything missing filled in. */
export function parseDefinition(json: string): RuleDefinition {
  try {
    const d = JSON.parse(json) as Partial<RuleDefinition>;
    return {
      match: d.match === "any" ? "any" : "all",
      conditions: Array.isArray(d.conditions) ? d.conditions : [],
      actions: Array.isArray(d.actions) ? d.actions.map((a) => ({ ...newAction(), ...a })) : [],
      example: d.example,
    };
  } catch {
    return emptyDefinition();
  }
}

/**
 * A new rule's conditions from the table's current context: its filter rules
 * (with all/any) and the search text as "Name contains …".
 */
export function definitionFromFilter(rules: FilterRule[], match: FilterMatch, search: string): RuleDefinition {
  const conditions = rules
    .filter((r) => r.op === "empty" || r.op === "not_empty" || r.value.trim() !== "")
    .map((r) => ({ ...r, id: Math.random().toString(36).slice(2) }));
  if (search.trim()) conditions.push({ ...newRule("name", "text"), op: "contains", value: search.trim() });
  return { match, conditions, actions: [newAction()] };
}

/** The slots a rule's patterns can fill: from every "matches pattern" condition. */
export function ruleSlots(def: RuleDefinition): string[] {
  const slots: string[] = [];
  for (const c of def.conditions) {
    if (c.op !== "matches") continue;
    for (const s of patternFor(c.value.trim())?.slots ?? []) if (!slots.includes(s)) slots.push(s);
  }
  return slots;
}

// ── Running ─────────────────────────────────────────────────────────────────

export interface RuleEnv {
  /** A column's value as the table and its filters see it (implied values included). */
  valueOf: (file: FileRecord, column: string) => unknown;
  kindOf: (column: string) => ColumnKind;
  /** A property's type, or null if there's no such property. */
  typeOf: (property: string) => ValueType | null;
  configOf: (property: string) => PropertyConfig;
  /** Values rules have already written (see writeKeys). */
  written: Set<string>;
}

/** The record of rule writes as lookup keys: per value, and per property ("hand edits win"). */
export function writeKeys(writes: RuleWrite[]): Set<string> {
  const keys = new Set<string>();
  for (const w of writes) {
    keys.add(`${w.rule_id}|${w.file_id}|${w.key}`);
    keys.add(`${w.rule_id}|${w.file_id}|${w.key}|${w.value}`);
  }
  return keys;
}

export interface PreviewChange {
  property: string;
  from: unknown;
  to: unknown;
}

export type PreviewStatus = "change" | "set" | "nomatch" | "edited";

export interface PreviewRow {
  file: FileRecord;
  status: PreviewStatus;
  changes: PreviewChange[];
  /** Why an action wrote nothing to this file ("no {Code}", a formula's mistake…). */
  problems: string[];
  /**
   * What the rule read, to check it against: each pattern's column and the
   * text that fitted (or, when none did, what was there), and each column a
   * value was copied from.
   */
  sources: { column: string; text: string }[];
  /** The values the patterns picked out ({Test} = 0014…). */
  slots: Record<string, string>;
}

export interface RulePlan {
  rows: PreviewRow[];
  edits: CellEdit[];
  writes: RuleWrite[];
  counts: { match: number; change: number; set: number; nomatch: number; edited: number };
}

const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const hasItem = (list: string[], v: string) => list.some((x) => x.localeCompare(v, undefined, { sensitivity: "base" }) === 0);

const asText = (v: unknown) => (Array.isArray(v) ? v.map(valueToText).join(", ") : valueToText(v));

/** A column by its header's name: a native one (Created, Source Tags…) or a property. */
export function columnByName(name: string): string {
  const native = Object.entries(NATIVE_LABELS).find(([, label]) => label.toLowerCase() === name.trim().toLowerCase());
  return native ? native[0] : PROP_PREFIX + name;
}

function formulaContext(file: FileRecord, slots: Record<string, string>, env: RuleEnv): FormulaContext {
  const rel = (file.relative_path ?? file.file_path).replace(/\\/g, "/");
  const folders = folderNames(file);
  return {
    name: baseName(file.file_path),
    filename: fileName(file.file_path),
    ext: fileExtension(file.file_path),
    path: rel,
    folder: folders[folders.length - 1] ?? "",
    folders,
    created: asText(env.valueOf(file, "created")),
    modified: asText(env.valueOf(file, "modified")),
    kind: asText(env.valueOf(file, "type")),
    size: asText(env.valueOf(file, "size")),
    slots,
    prop: (name) => asText(env.valueOf(file, columnByName(name))),
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Part of a column's value, for a "from property" action: an item of a list,
 * or a piece of a date. Lists stay lists for "all".
 */
export function columnPart(value: unknown, part: string | undefined): string | string[] | null {
  if (value == null || value === "") return null;
  if (Array.isArray(value)) {
    const items = value.map(valueToText).filter(Boolean);
    if (!part || part === "all") return items.length > 0 ? items : null;
    if (part === "first") return items[0] ?? null;
    if (part === "last") return items[items.length - 1] ?? null;
    if (part.startsWith("n:")) return items[Number(part.slice(2)) - 1] ?? null;
    return items.join(", ");
  }
  const text = valueToText(value);
  if (!part || part === "all") return text;
  const key = dateKey(text);
  if (!key) return text;
  const [y, m, d] = key.split("-").map(Number);
  switch (part) {
    case "date":
      return key;
    case "year":
      return String(y);
    case "month":
      return String(m).padStart(2, "0");
    case "monthName":
      return MONTHS[m - 1];
    case "yearMonth":
      return `${y}-${String(m).padStart(2, "0")}`;
    case "quarter":
      return `Q${Math.ceil(m / 3)}`;
    case "weekday":
      return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long" });
    default:
      return text;
  }
}

/** An action's value for one file, or why there's none. */
function actionValue(
  action: RuleAction,
  type: ValueType,
  config: PropertyConfig,
  slots: Record<string, string>,
  file: FileRecord,
  env: RuleEnv
): { value: unknown } | { problem: string } | null {
  let text: string;
  if (action.mode === "column") {
    if (!action.value) return null;
    const part = columnPart(env.valueOf(file, action.value), action.part);
    if (part == null) return null;
    // A list stays a list into a Multi-select; elsewhere its items are joined
    if (Array.isArray(part)) {
      if (type === "array" && !action.format) return { value: coerceValue(part, type, config) };
      text = part.join(", ");
    } else {
      text = part;
    }
  } else if (action.mode === "slot") {
    if (!(action.value in slots)) return { problem: `no {${action.value}}` };
    text = slots[action.value];
  } else if (action.mode === "formula") {
    try {
      text = runFormula(action.value, formulaContext(file, slots, env));
    } catch (e) {
      return { problem: e instanceof FormulaError ? e.message : String(e) };
    }
  } else {
    text = action.value;
  }
  text = text.trim();
  if (text === "") return null;
  const format = action.format ?? "";
  if (format === "number") {
    const n = parseNumber(text);
    if (n == null) return { problem: `“${text}” isn't a number` };
    return { value: coerceValue(n, type, config) };
  }
  if (format) {
    const date = parseDateAs(text, format);
    if (!date) return { problem: `“${text}” isn't a ${format} date` };
    return { value: coerceValue(date, type, config) };
  }
  const value = coerceValue(text, type, config);
  // A Date property only takes real dates: text like "250612" needs reading as one (YYMMDD…)
  if (type === "date" && !dateKey(value)) return { problem: `“${text}” isn't a date: choose how to read it (as YYMMDD…)` };
  return { value };
}

/** A slot named after a date format ({YYMMDD}) is read as that format. */
export function formatForSlot(slot: string): string {
  return DATE_FORMATS.find((f) => f.toLowerCase() === slot.trim().toLowerCase()) ?? "";
}

/**
 * What a rule would do to each file. `working` holds files' metadata as
 * edits so far leave it (earlier actions and rules in the same run); it's
 * updated with this rule's writes, so a later rule sees them filled.
 */
export function planRule(
  ruleId: string,
  def: RuleDefinition,
  files: FileRecord[],
  env: RuleEnv,
  working: Map<string, Record<string, unknown>> = new Map()
): RulePlan {
  const rows: PreviewRow[] = [];
  const edits: CellEdit[] = [];
  const writes: RuleWrite[] = [];
  let patternMisses = 0;
  const meta = (f: FileRecord) => {
    let m = working.get(f.file_id);
    if (!m) {
      m = { ...((f.metadata as Record<string, unknown> | null) ?? {}) };
      working.set(f.file_id, m);
    }
    return m;
  };

  for (const file of files) {
    const results = def.conditions.map((c) => matchesRule(env.valueOf(file, c.column), env.kindOf(c.column), c));
    let matched: boolean;
    let nomatch = false;
    if (def.match === "any" && def.conditions.length > 0) {
      matched = results.some(Boolean);
    } else {
      matched = results.every(Boolean);
      // Everything but a pattern holds: the name just doesn't fit it
      nomatch =
        !matched &&
        def.conditions.some((c, i) => c.op === "matches" && !results[i]) &&
        def.conditions.every((c, i) => c.op === "matches" || results[i]);
    }
    if (!matched && !nomatch) continue;
    // What each pattern read: the text that fitted, or what was there when none did
    const sources: { column: string; text: string }[] = [];
    const slots: Record<string, string> = {};
    def.conditions.forEach((c, i) => {
      if (c.op !== "matches") return;
      const value = env.valueOf(file, c.column);
      const pattern = results[i] ? patternFor(c.value.trim()) : null;
      const found = pattern ? patternMatch(pattern, value, c.item) : null;
      if (found) {
        sources.push({ column: c.column, text: found.text });
        Object.assign(slots, found.slots);
      } else {
        const items = Array.isArray(value) ? listItems(value.map(valueToText), c.item) : [valueToText(value)];
        sources.push({ column: c.column, text: items.filter(Boolean).join(", ") });
      }
    });
    if (nomatch) {
      rows.push({ file, status: "nomatch", changes: [], problems: ["doesn't fit the pattern"], sources, slots });
      patternMisses++;
      continue;
    }
    for (const action of def.actions) {
      if (action.mode === "column" && action.value && !sources.some((x) => x.column === action.value)) {
        sources.push({ column: action.value, text: asText(env.valueOf(file, action.value)) });
      }
    }

    const m = meta(file);
    const changes: PreviewChange[] = [];
    const problems: string[] = [];
    let edited = false;
    for (const action of def.actions) {
      if (!action.property) continue;
      const type = env.typeOf(action.property);
      if (!type) {
        problems.push(`there's no property “${action.property}”`);
        continue;
      }
      const result = actionValue(action, type, env.configOf(action.property), slots, file, env);
      if (!result) continue;
      if ("problem" in result) {
        problems.push(result.problem);
        continue;
      }
      const key = action.property;
      const current = m[key] ?? null;
      const wroteKey = env.written.has(`${ruleId}|${file.file_id}|${key}`);
      if (type === "array" && !action.overwrite) {
        // A Multi-select gains the values it doesn't have, except ones taken off by hand
        const items = listValues(result.value);
        const have = listValues(current);
        const add: string[] = [];
        for (const item of items) {
          if (hasItem(have, item)) continue;
          if (env.written.has(`${ruleId}|${file.file_id}|${key}|${JSON.stringify(item)}`)) edited = true;
          else add.push(item);
        }
        if (add.length === 0) continue;
        const next = [...have, ...add];
        changes.push({ property: key, from: current, to: next });
        edits.push({ file_id: file.file_id, key, value: next });
        for (const item of add) writes.push({ rule_id: ruleId, file_id: file.file_id, key, value: JSON.stringify(item) });
        m[key] = next;
        continue;
      }
      if (same(current, result.value)) continue;
      if (wroteKey) {
        // Written before and changed since: the hand edit stands
        edited = true;
        continue;
      }
      if (!isEmpty(current) && !action.overwrite) continue;
      changes.push({ property: key, from: current, to: result.value });
      edits.push({ file_id: file.file_id, key, value: result.value });
      writes.push({ rule_id: ruleId, file_id: file.file_id, key, value: JSON.stringify(result.value) });
      m[key] = result.value;
    }
    const status: PreviewStatus =
      changes.length > 0 ? "change" : edited ? "edited" : problems.length > 0 && def.actions.length > 0 ? "nomatch" : "set";
    rows.push({ file, status, changes, problems, sources, slots });
  }

  const count = (s: PreviewStatus) => rows.filter((r) => r.status === s).length;
  return {
    rows,
    edits,
    writes,
    counts: {
      // Files meeting the conditions (a name that doesn't fit the pattern doesn't)
      match: rows.length - patternMisses,
      change: count("change"),
      set: count("set"),
      nomatch: count("nomatch"),
      edited: count("edited"),
    },
  };
}

/**
 * Every enabled rule in order over the files, as one batch to write. Earlier
 * rules fill first, so they win when two set the same empty value.
 */
export function planRules(rules: StoredRule[], files: FileRecord[], env: RuleEnv): { edits: CellEdit[]; writes: RuleWrite[] } {
  const working = new Map<string, Record<string, unknown>>();
  const byCell = new Map<string, CellEdit>();
  const writes: RuleWrite[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const plan = planRule(rule.rule_id, parseDefinition(rule.definition), files, env, working);
    for (const e of plan.edits) byCell.set(`${e.file_id}|${e.key}`, e);
    writes.push(...plan.writes);
  }
  return { edits: [...byCell.values()], writes };
}
