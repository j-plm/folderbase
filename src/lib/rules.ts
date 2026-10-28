import { listItems, matchesRule, newRule, patternFor, patternMatch, type ColumnKind, type FilterMatch, type FilterRule } from "./dbTable";
import { FormulaError, runFormula, type FormulaContext } from "./formula";
import { DATE_FORMATS, parseDateAs, type ExampleSlot } from "./patterns";
import { coerceValue, dateKey, dateTimeKey, listValues, parseNumber, timeOfKey, valueToText } from "./propertyTypes";
import { NATIVE_LABELS, PROP_PREFIX, baseName, fileExtension, fileName, folderNames } from "./fileColumns";
import type { CellEdit } from "./commands";
import type { FileRecord, PropertyConfig, ValueType } from "../types";

// Rules: "when these conditions hold, set these values" (spec ▸ Rules).
// Pure: the caller says how to read columns and what the properties are, so
// the same code previews a rule in the editor and runs it in the background.

/**
 * Where an action's value comes from: typed in, a slot of the rule's pattern,
 * another column, a formula, or other files that share the same values.
 */
export type ActionMode = "fixed" | "slot" | "column" | "formula" | "same";

export interface RuleAction {
  id: string;
  property: string;
  mode: ActionMode;
  /**
   * The fixed text, the slot's name, the column's id ("created", "tags", "prop:Client"),
   * the formula, or (for "same") the first column files must share.
   */
  value: string;
  /** For "same": further columns files must share ("same Test and Project"). */
  also?: string[];
  /**
   * For a column: which part of its value. A list (Path Tags, a Multi-select):
   * "all", "first", "last" or "n:2" (the 2nd). A date: "date", "dateTime",
   * "time" (10:15), "hour", "year", "month", "monthName", "yearMonth", "quarter"
   * or "weekday". Missing: the whole value.
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
   * its text, the column it came from (Name if missing), and the "matches
   * pattern" condition it writes (missing in rules saved before: the one on its column).
   */
  example?: { name: string; slots: ExampleSlot[]; column?: string; item?: string; condition?: string };
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
 * A new rule's conditions from the table's current context: the folder it's
 * in (its place's conditions), its filter rules (with all/any) and the search
 * text as "Name contains …". A rule has one all/any, so the folder joins only
 * filters that all hold (or a single one); "any of" several filters keeps
 * just the filters.
 */
export function definitionFromFilter(rules: FilterRule[], match: FilterMatch, search: string, place: FilterRule[] = []): RuleDefinition {
  const fresh = (r: FilterRule) => ({ ...r, id: Math.random().toString(36).slice(2) });
  const own = rules.filter((r) => r.op === "empty" || r.op === "not_empty" || r.value.trim() !== "").map(fresh);
  if (search.trim()) own.push({ ...newRule("name", "text"), op: "contains", value: search.trim() });
  if (match === "any" && own.length > 1) return { match, conditions: own, actions: [newAction()] };
  return { match: "all", conditions: [...place.map(fresh), ...own], actions: [newAction()] };
}

/**
 * The filter's conditions added to a rule's own, skipping any it already has.
 * A rule with no conditions yet takes the filter's all/any too.
 */
export function withFilterConditions(def: RuleDefinition, filter: RuleDefinition): RuleDefinition {
  const same = (a: FilterRule, b: FilterRule) => a.column === b.column && a.op === b.op && a.value === b.value && a.item === b.item;
  const added = filter.conditions.filter((c) => !def.conditions.some((d) => same(c, d)));
  if (added.length === 0) return def;
  return {
    ...def,
    match: def.conditions.length === 0 ? filter.match : def.match,
    conditions: [...def.conditions, ...added],
  };
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
  /** Write over values changed by hand since the rule set them, too (Apply Now, asked for). */
  overHandEdits?: boolean;
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

/** A column by its header's name: a native one (Created, Path Tags…) or a property. */
export function columnByName(name: string): string {
  const wanted = name.trim().toLowerCase();
  if (FORMER_LABELS[wanted]) return FORMER_LABELS[wanted];
  const native = Object.entries(NATIVE_LABELS).find(([, label]) => label.toLowerCase() === wanted);
  return native ? native[0] : PROP_PREFIX + name;
}

/** Native columns' former names, so formulas written before a rename still read them. */
const FORMER_LABELS: Record<string, string> = { "source tags": "tags" };

/** What a formula can read on a file: its name, dates, folders, the rule's slots and any column. */
export function formulaContext(file: FileRecord, slots: Record<string, string>, env: RuleEnv): FormulaContext {
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
  const full = dateTimeKey(text);
  if (!full) return text;
  const key = full.slice(0, 10);
  const time = timeOfKey(full);
  const [y, m, d] = key.split("-").map(Number);
  switch (part) {
    case "date":
      return key;
    case "dateTime":
      return full;
    case "time":
      return time ? time.slice(0, 5) : null;
    case "hour":
      return time ? time.slice(0, 2) : null;
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

// ── From files with the same … ───────────────────────────────────────────────

/** A column's header name, for messages. */
function columnLabel(column: string): string {
  return column.startsWith(PROP_PREFIX) ? column.slice(PROP_PREFIX.length) : NATIVE_LABELS[column] ?? column;
}

/** The columns a "same" action matches on, in order, without blanks. */
export function sameColumns(action: RuleAction): string[] {
  return [action.value, ...(action.also ?? [])].filter(Boolean);
}

/** What a file shares with others for a "same" action, or null if any of the columns is empty. */
function sameKey(file: FileRecord, columns: string[], env: RuleEnv): string | null {
  const parts: string[] = [];
  for (const column of columns) {
    const items = listValues(env.valueOf(file, column)).map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (items.length === 0) return null;
    parts.push(items.sort().join("\u0001"));
  }
  return parts.join("\u0002");
}

/** The values files sharing a key have for the property, each with how many files have it. */
type SameLookup = Map<string, Map<string, { value: unknown; count: number }>>;

/**
 * The property's values on files that have one, by what they share. Read as
 * stored (implied values included), not as earlier writes in the same run leave them.
 */
export function sameLookup(action: RuleAction, files: FileRecord[], env: RuleEnv): SameLookup {
  const lookup: SameLookup = new Map();
  const columns = sameColumns(action);
  if (!action.property || columns.length === 0) return lookup;
  for (const file of files) {
    const value = env.valueOf(file, PROP_PREFIX + action.property);
    if (isEmpty(value)) continue;
    const key = sameKey(file, columns, env);
    if (key == null) continue;
    let values = lookup.get(key);
    if (!values) lookup.set(key, (values = new Map()));
    // Values the same but for case or order are one value
    const id = listValues(value).map((v) => v.toLowerCase()).sort().join("\u0001");
    const seen = values.get(id);
    if (seen) seen.count++;
    else values.set(id, { value, count: 1 });
  }
  return lookup;
}

/** The value files sharing this file's values agree on, or why there's none. */
function sameValue(action: RuleAction, file: FileRecord, env: RuleEnv, lookup: SameLookup): { value: unknown } | { problem: string } | null {
  const columns = sameColumns(action);
  const key = sameKey(file, columns, env);
  const values = key == null ? undefined : lookup.get(key);
  if (!values || values.size === 0) return null;
  const found = [...values.values()];
  if (found.length === 1) return { value: found[0].value };
  const shared = columns.map((c) => `${columnLabel(c)} ${asText(env.valueOf(file, c))}`).join(", ");
  const counts = found
    .sort((a, b) => b.count - a.count)
    .map((f, i) => `${i === 0 ? `${action.property} ` : ""}${asText(f.value)} in ${f.count} ${f.count === 1 ? "file" : "files"}`)
    .join(", ");
  return { problem: `${shared} is on ${counts}` };
}

/** An action's value for one file, or why there's none. */
function actionValue(
  action: RuleAction,
  type: ValueType,
  config: PropertyConfig,
  slots: Record<string, string>,
  file: FileRecord,
  env: RuleEnv,
  lookup?: SameLookup
): { value: unknown } | { problem: string } | null {
  let text: string;
  if (action.mode === "same") {
    const found = sameValue(action, file, env, lookup ?? new Map());
    if (!found || "problem" in found) return found;
    return { value: coerceValue(found.value, type, config) };
  }
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

/** Why an action gave nothing for a file whose property is empty. */
function nothingReason(action: RuleAction, slots: Record<string, string>): string {
  switch (action.mode) {
    case "slot":
      return action.value in slots ? `{${action.value}} is empty` : "choose a slot";
    case "formula":
      return action.value.trim() ? "the formula gives nothing" : "type a formula";
    case "column":
      return action.value ? `${columnLabel(action.value)} is empty` : "choose a property to copy";
    case "same": {
      const columns = sameColumns(action);
      if (columns.length === 0) return "choose a property to match on";
      return `no file with the same ${columns.map(columnLabel).join(" and ")} has a ${action.property}`;
    }
    default:
      return "type a value";
  }
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

  // Every file teaches, whether or not it meets the conditions
  const lookups = new Map<string, SameLookup>();
  for (const action of def.actions) {
    if (action.mode === "same") lookups.set(action.id, sameLookup(action, files, env));
  }

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
      const read = action.mode === "column" ? [action.value] : action.mode === "same" ? sameColumns(action) : [];
      for (const column of read) {
        if (column && !sources.some((x) => x.column === column)) sources.push({ column, text: asText(env.valueOf(file, column)) });
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
      const result = actionValue(action, type, env.configOf(action.property), slots, file, env, lookups.get(action.id));
      if (!result) {
        // Nothing to write and nothing there: say why, rather than show it as already set
        if (isEmpty(m[action.property])) problems.push(nothingReason(action, slots));
        continue;
      }
      if ("problem" in result) {
        problems.push(result.problem);
        continue;
      }
      const key = action.property;
      const current = m[key] ?? null;
      const prefix = `${ruleId}|${file.file_id}|${key}`;
      /** A value (or list item) this rule wrote here before. */
      const wrote = (v: unknown) => env.written.has(`${prefix}|${JSON.stringify(v)}`);
      if (type === "array" && !action.overwrite) {
        // A Multi-select gains the values it doesn't have, except ones taken off by hand
        const items = listValues(result.value);
        const have = listValues(current);
        // Items this rule added that it no longer gives (the rule was changed): it takes them back
        const keep = have.filter((h) => hasItem(items, h) || !wrote(h));
        const add: string[] = [];
        for (const item of items) {
          if (hasItem(have, item)) continue;
          if (wrote(item) && !env.overHandEdits) edited = true;
          else add.push(item);
        }
        if (add.length === 0 && keep.length === have.length) continue;
        const next = [...keep, ...add];
        changes.push({ property: key, from: current, to: next });
        edits.push({ file_id: file.file_id, key, value: next });
        for (const item of add) writes.push({ rule_id: ruleId, file_id: file.file_id, key, value: JSON.stringify(item) });
        m[key] = next;
        continue;
      }
      if (same(current, result.value)) continue;
      // Still what this rule wrote: the rule may change it (its definition was edited)
      const own = !isEmpty(current) && wrote(current);
      const handEdited = env.written.has(prefix) && !own;
      if (handEdited && !env.overHandEdits) {
        // Written before and changed since: the hand edit stands
        edited = true;
        continue;
      }
      if (!isEmpty(current) && !own && !handEdited && !action.overwrite) continue;
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
