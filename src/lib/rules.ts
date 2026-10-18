import { matchesRule, newRule, patternFor, type ColumnKind, type FilterMatch, type FilterRule } from "./dbTable";
import { FormulaError, runFormula, type FormulaContext } from "./formula";
import { matchPattern, parseDateAs, type ExampleSlot } from "./patterns";
import { coerceValue, listValues, parseNumber, valueToText } from "./propertyTypes";
import { PROP_PREFIX, baseName, fileExtension, fileName } from "./fileColumns";
import type { CellEdit } from "./commands";
import type { FileRecord, PropertyConfig, ValueType } from "../types";

// Rules: "when these conditions hold, set these values" (spec ▸ Rules).
// Pure: the caller says how to read columns and what the properties are, so
// the same code previews a rule in the editor and runs it in the background.

/** Where an action's value comes from: typed in, a slot of the rule's pattern, or a formula. */
export type ActionMode = "fixed" | "slot" | "formula";

export interface RuleAction {
  id: string;
  property: string;
  mode: ActionMode;
  /** The fixed text, the slot's name, or the formula. */
  value: string;
  /** How to read the text before writing it: "" as it is, "number", or a date format such as "YYMMDD". */
  format?: string;
  /** Write over an existing value (off: only empty values are filled; a Multi-select gains the value). */
  overwrite?: boolean;
}

export interface RuleDefinition {
  match: FilterMatch;
  conditions: FilterRule[];
  actions: RuleAction[];
  /** The example name slots were picked from, kept so the picks can be adjusted later. */
  example?: { name: string; slots: ExampleSlot[] };
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

function formulaContext(file: FileRecord, slots: Record<string, string>, env: RuleEnv): FormulaContext {
  const rel = (file.relative_path ?? file.file_path).replace(/\\/g, "/");
  const parts = rel.split("/");
  return {
    name: baseName(file.file_path),
    filename: fileName(file.file_path),
    ext: fileExtension(file.file_path),
    path: rel,
    folder: parts.length > 1 ? parts[parts.length - 2] : "",
    slots,
    prop: (name) => {
      const v = env.valueOf(file, PROP_PREFIX + name);
      return Array.isArray(v) ? v.map(valueToText).join(", ") : valueToText(v);
    },
  };
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
  if (action.mode === "slot") {
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
  return { value: coerceValue(text, type, config) };
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
    if (nomatch) {
      rows.push({ file, status: "nomatch", changes: [], problems: ["the name doesn't fit the pattern"] });
      patternMisses++;
      continue;
    }

    const slots: Record<string, string> = {};
    def.conditions.forEach((c, i) => {
      if (c.op !== "matches" || !results[i]) return;
      const pattern = patternFor(c.value.trim());
      const v = env.valueOf(file, c.column);
      const found = pattern ? matchPattern(pattern, Array.isArray(v) ? v.join(", ") : valueToText(v)) : null;
      Object.assign(slots, found ?? {});
    });

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
    rows.push({ file, status, changes, problems });
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
