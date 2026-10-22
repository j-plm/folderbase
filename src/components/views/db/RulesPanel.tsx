import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { popoverField, popoverSelect } from "../../shared/Popover";
import { SymbolIcon } from "../../../lib/fileIcons";
import { listItems, matchesRule, newRule, type FilterMatch } from "../../../lib/dbTable";
import { dropIndexAt, moveColumnId } from "../../../lib/columns";
import { baseName, fileName } from "../../../lib/fileColumns";
import { formulaProblem, FORMULA_FUNCTIONS } from "../../../lib/formula";
import { DATE_FORMATS, examplePattern, type ExampleSlot } from "../../../lib/patterns";
import { valueToText } from "../../../lib/propertyTypes";
import {
  emptyDefinition,
  formatForSlot,
  newAction,
  parseDefinition,
  planRule,
  ruleSlots,
  type ActionMode,
  type RuleAction,
  type RuleDefinition,
  type RuleEnv,
  type PreviewStatus,
  type RulePlan,
  type StoredRule,
} from "../../../lib/rules";
import { AddButton, ConditionRows, RemoveButton, itemChoices, type FilterColumn } from "./FilterSortPopover";
import RulesHelp from "./RulesHelp";
import Dialog, { DialogButton } from "../../shared/Dialog";

/** A remembered size (panel widths, preview columns); the fallback if storage is unavailable. */
function loadSize<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function saveSize(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/** Drags a width from a press: `apply` on every move, then once more with `done`. */
function dragWidth(e: React.MouseEvent, start: number, min: number, max: number, sign: 1 | -1, apply: (w: number, done: boolean) => void) {
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX;
  let latest = start;
  const onMove = (ev: MouseEvent) => {
    latest = Math.round(Math.min(max, Math.max(min, start + sign * (ev.clientX - x0))));
    apply(latest, false);
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    apply(latest, true);
  };
  document.body.style.cursor = "col-resize";
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
import type { FileRecord, ValueType } from "../../../types";

interface Props {
  /** Width in px, dragged at the left edge (`save` once the drag ends). */
  width: number;
  onResize: (width: number, save: boolean) => void;
  library: string;
  rules: StoredRule[];
  /** The location's files (as the table has them). */
  files: FileRecord[];
  env: RuleEnv;
  columns: FilterColumn[];
  properties: { name: string; type: ValueType }[];
  valuesFor: (columnId: string) => string[];
  /** A new rule to start from (Make Rule from Filter…). */
  draft: RuleDefinition | null;
  /** The view's current filter as a rule, offered as a starting point (null: no filter). */
  viewFilter: RuleDefinition | null;
  onSave: (rule: StoredRule) => Promise<StoredRule | null>;
  onDelete: (ruleId: string) => Promise<void>;
  onReorder: (ruleIds: string[]) => Promise<void>;
  onApplyNow: (rule: StoredRule, plan: RulePlan) => Promise<void>;
  /** Then set ▸ New Property…: creates it (shown in the table); false if it couldn't be made. */
  onCreateProperty: (name: string, type: ValueType) => Promise<boolean>;
  /** The rule being looked at, so the table can show just its files (null: all files). */
  onFocus: (rule: { name: string; definition: RuleDefinition } | null) => void;
  onClose: () => void;
}

const NEW = "__new";

/** The narrowest the panel can be dragged; the table beside it always keeps at least TABLE_MIN_WIDTH. */
export const RULES_PANEL_MIN_WIDTH = 520;
const TABLE_MIN_WIDTH = 280;

interface Editing {
  rule_id: string;
  name: string;
  enabled: boolean;
  def: RuleDefinition;
  dirty: boolean;
}

function editingOf(rule: StoredRule): Editing {
  return { rule_id: rule.rule_id, name: rule.name, enabled: rule.enabled, def: parseDefinition(rule.definition), dirty: false };
}

/**
 * Rules (spec ▸ Rules): the library's rules on the left, in order; the
 * selected rule's editor on the right — When (conditions), Then (actions),
 * and a preview of what it would do before anything is written.
 */
export default function RulesPanel(props: Props) {
  const { rules, files, env, draft, onFocus } = props;
  const [selected, setSelected] = useState<string | null>(draft ? NEW : (rules[0]?.rule_id ?? null));
  const [editing, setEditing] = useState<Editing | null>(() =>
    draft
      ? { rule_id: "", name: "New Rule", enabled: false, def: draft, dirty: true }
      : rules[0]
        ? editingOf(rules[0])
        : null
  );
  const [overHandEdits, setOverHandEdits] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [listWidth, setListWidth] = useState(() => loadSize("rules-list-width", 230));
  const panelRef = useRef<HTMLDivElement>(null);

  // Mouse events, not pointer events: after a native menu closes WebKit can still
  // think the button is down and skip the next pointerdown, so the first click did nothing
  function startResize(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelRef.current?.offsetWidth ?? props.width;
    const max = (panelRef.current?.parentElement?.clientWidth ?? window.innerWidth) - TABLE_MIN_WIDTH;
    let latest = startWidth;
    const onMove = (ev: MouseEvent) => {
      latest = Math.round(Math.min(max, Math.max(RULES_PANEL_MIN_WIDTH, startWidth + startX - ev.clientX)));
      props.onResize(latest, false);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      props.onResize(latest, true);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The table shows the rule's files while it's being looked at
  useEffect(() => {
    onFocus(editing ? { name: editing.name, definition: editing.def } : null);
  }, [editing, onFocus]);
  useEffect(() => () => onFocus(null), [onFocus]);

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of rules) out.set(r.rule_id, planRule(r.rule_id, parseDefinition(r.definition), files, env).counts.match);
    return out;
  }, [rules, files, env]);

  const previewEnv = useMemo(() => (overHandEdits ? { ...env, written: new Set<string>() } : env), [env, overHandEdits]);
  const plan = useMemo(
    () => (editing ? planRule(editing.rule_id || NEW, editing.def, files, previewEnv) : null),
    [editing, files, previewEnv]
  );

  function stored(e: Editing): StoredRule {
    const existing = rules.find((r) => r.rule_id === e.rule_id);
    return {
      rule_id: e.rule_id,
      library: props.library,
      name: e.name.trim() || "Untitled Rule",
      enabled: e.enabled,
      position: existing?.position ?? 0,
      definition: JSON.stringify(e.def),
    };
  }

  async function save(e: Editing | null = editing): Promise<StoredRule | null> {
    if (!e) return null;
    setError(null);
    const saved = await props.onSave(stored(e));
    if (saved) {
      setSelected(saved.rule_id);
      // A new rule takes its id even if typing carried on meanwhile (so the next save updates it, not adds another)
      setEditing((cur) =>
        cur && cur.rule_id === e.rule_id ? { ...cur, rule_id: saved.rule_id, dirty: cur === e ? false : cur.dirty } : cur
      );
    }
    return saved;
  }

  /** Switching rules saves the one being edited first. */
  async function select(id: string) {
    if (editing?.dirty) await save();
    const rule = rules.find((r) => r.rule_id === id);
    setSelected(id);
    setEditing(rule ? editingOf(rule) : null);
  }

  function startNew(def: RuleDefinition = emptyDefinition()) {
    setSelected(NEW);
    setEditing({ rule_id: "", name: "New Rule", enabled: false, def, dirty: true });
  }

  const change = (patch: Partial<Editing>) => setEditing((e) => (e ? { ...e, ...patch, dirty: true } : e));
  const changeDef = (patch: Partial<RuleDefinition>) => setEditing((e) => (e ? { ...e, def: { ...e.def, ...patch }, dirty: true } : e));

  async function applyNow() {
    if (!editing || !plan) return;
    setBusy(true);
    try {
      const saved = editing.dirty || !editing.rule_id ? await save() : rules.find((r) => r.rule_id === editing.rule_id) ?? null;
      if (!saved) return;
      // Planned again under the saved id, so the writes are recorded as this rule's
      await props.onApplyNow(saved, planRule(saved.rule_id, editing.def, files, previewEnv));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const [confirmDelete, setConfirmDelete] = useState(false);
  async function remove() {
    setConfirmDelete(false);
    if (!editing) return;
    if (editing.rule_id) await props.onDelete(editing.rule_id);
    const next = rules.find((r) => r.rule_id !== editing.rule_id);
    setSelected(next?.rule_id ?? null);
    setEditing(next ? editingOf(next) : null);
  }

  async function close() {
    if (editing?.dirty && editing.rule_id) await save();
    props.onClose();
  }

  return (
    <div
      ref={panelRef}
      style={{ width: props.width, maxWidth: `calc(100% - ${TABLE_MIN_WIDTH}px)` }}
      className="absolute right-0 top-0 h-full flex flex-col bg-neutral-900 border-l border-neutral-700/60 shadow-2xl z-50 text-body"
    >
      {/* Drag the left edge to resize */}
      <div
        onMouseDown={startResize}
        className="absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize z-10"
        aria-hidden
      />
      <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-700/60 shrink-0">
        <h2 className="text-sm font-medium text-neutral-100">Rules</h2>
        <span className="flex-1" />
        <button
          onClick={() => setHelpOpen((o) => !o)}
          title="Patterns and formulas: everything they can say, and a place to try one"
          className={`flex items-center gap-1 h-6 px-2 mr-1 rounded-[6px] text-xs ${helpOpen ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"}`}
        >
          <SymbolIcon name="questionmark.circle" size={12} fallback="?" />
          Pattern Help
        </button>
        <button
          onClick={() => void close()}
          className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200"
          aria-label="Close Rules"
        >
          <SymbolIcon name="xmark" size={11} fallback="✕" />
        </button>
      </div>

      <div className="relative flex flex-1 min-h-0">
        <RuleList
          width={listWidth}
          rules={rules}
          counts={counts}
          selected={selected}
          newSelected={selected === NEW}
          onSelect={(id) => void select(id)}
          onNew={() => startNew()}
          onNewFromFilter={props.viewFilter ? () => startNew(props.viewFilter!) : undefined}
          onToggle={(rule) => void props.onSave({ ...rule, enabled: !rule.enabled })}
          onReorder={props.onReorder}
        />
        {/* Drag to make the list of rules wider or narrower */}
        <div
          onMouseDown={(e) =>
            dragWidth(e, listWidth, 140, 480, 1, (w, done) => {
              setListWidth(w);
              if (done) saveSize("rules-list-width", w);
            })
          }
          className="w-1.5 -mx-[3px] shrink-0 cursor-col-resize z-10"
          aria-hidden
        />

        <div className="flex-1 min-w-0 overflow-y-auto">
          {!editing ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-neutral-500">
              <p>No rule selected.</p>
            </div>
          ) : (
            <RuleEditor
              key={editing.rule_id || NEW}
              editing={editing}
              plan={plan}
              files={files}
              env={env}
              columns={props.columns}
              properties={props.properties}
              valuesFor={props.valuesFor}
              onCreateProperty={props.onCreateProperty}
              onChange={change}
              onChangeDef={changeDef}
            />
          )}
        </div>
        {helpOpen && <RulesHelp onClose={() => setHelpOpen(false)} />}
      </div>

      {editing && (
        <div className="flex items-center gap-2 px-5 py-3 border-t border-neutral-700/60 shrink-0">
          <button
            type="button"
            // A saved rule asks first; an unsaved new one just goes
            onClick={() => (editing.rule_id ? setConfirmDelete(true) : void remove())}
            className="h-6 px-3 rounded-[6px] text-sm bg-red-900 text-red-500"
          >
            {editing.rule_id ? "Delete Rule" : "Discard"}
          </button>
          <label className="flex items-center gap-1.5 ml-3 text-neutral-400" title="Apply Now writes over values you've changed by hand, too">
            <input type="checkbox" checked={overHandEdits} onChange={(e) => setOverHandEdits(e.target.checked)} />
            Include values changed by hand
          </label>
          {error && <span className="text-red-500 text-xs truncate">{error}</span>}
          <span className="flex-1" />
          <button
            type="button"
            disabled={!editing.dirty}
            onClick={() => void save()}
            className="h-6 min-w-[74px] px-3 rounded-[6px] text-sm bg-neutral-700/70 text-neutral-100 disabled:text-neutral-500"
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy || !plan || plan.edits.length === 0}
            onClick={() => void applyNow()}
            className="h-6 min-w-[74px] px-3 rounded-[6px] text-sm bg-blue-500 text-white disabled:bg-neutral-700/70 disabled:text-neutral-500"
          >
            {plan && plan.edits.length > 0 ? `Apply Now (${plan.counts.change})` : "Apply Now"}
          </button>
        </div>
      )}

      {confirmDelete && editing && (
        <Dialog
          title={`Delete “${editing.name}”?`}
          message="The rule stops running. Values it has already set on files stay as they are."
          onCancel={() => setConfirmDelete(false)}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setConfirmDelete(false)} autoFocus>
                Cancel
              </DialogButton>
              <DialogButton variant="destructive" onClick={() => void remove()}>
                Delete
              </DialogButton>
            </>
          }
        />
      )}
    </div>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────

function RuleList({
  width,
  rules,
  counts,
  selected,
  newSelected,
  onSelect,
  onNew,
  onNewFromFilter,
  onToggle,
  onReorder,
}: {
  width: number;
  rules: StoredRule[];
  counts: Map<string, number>;
  selected: string | null;
  newSelected: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Present when the view is filtered. */
  onNewFromFilter?: () => void;
  onToggle: (rule: StoredRule) => void;
  onReorder: (ids: string[]) => Promise<void>;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; target: number } | null>(null);

  function startDrag(e: React.MouseEvent<HTMLElement>, id: string) {
    if (e.button !== 0 || rules.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-rule]") ?? [])];
    const heights = rows.map((r) => r.offsetHeight);
    const top = rows[0]?.getBoundingClientRect().top ?? 0;
    let target = rules.findIndex((r) => r.rule_id === id);
    setDrag({ id, target });
    const onMove = (ev: MouseEvent) => {
      target = dropIndexAt(heights, ev.clientY - top, 0);
      setDrag({ id, target });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDrag(null);
      const ids = rules.map((r) => r.rule_id);
      const order = moveColumnId(ids, id, target);
      if (order.some((x, i) => x !== ids[i])) void onReorder(order);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const from = drag ? rules.findIndex((r) => r.rule_id === drag.id) : -1;
  const line = drag && drag.target !== from && drag.target !== from + 1 ? drag.target : null;

  return (
    <div ref={listRef} style={{ width }} className="shrink-0 border-r border-neutral-700/60 overflow-y-auto py-2 px-2 flex flex-col gap-px">
      {rules.length === 0 && !newSelected && <p className="px-2 py-1 text-neutral-500">No rules yet.</p>}
      {rules.map((rule, i) => (
        <div
          key={rule.rule_id}
          data-rule
          onClick={() => onSelect(rule.rule_id)}
          className={`relative flex items-center gap-1.5 h-7 px-1.5 rounded-md cursor-default ${
            selected === rule.rule_id ? "native-selected" : "hover:bg-neutral-800"
          } ${drag?.id === rule.rule_id ? "opacity-50" : ""}`}
        >
          {line === i && <span className="absolute left-0 right-0 -top-px h-[2px] rounded-full bg-blue-500" />}
          {line === rules.length && i === rules.length - 1 && (
            <span className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-blue-500" />
          )}
          <span
            onMouseDown={(e) => startDrag(e, rule.rule_id)}
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder (earlier rules win)"
            className="w-3 text-neutral-500 cursor-grab"
          >
            <SymbolIcon name="line.3.horizontal" size={10} fallback="≡" />
          </span>
          <input
            type="checkbox"
            checked={rule.enabled}
            title={rule.enabled ? "On: runs whenever files load or change" : "Off: runs only with Apply Now"}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggle(rule)}
          />
          <span className={`truncate flex-1 ${rule.enabled ? "" : "text-neutral-400"}`}>{rule.name}</span>
          <span className="text-neutral-500 tabular-nums text-xs">{(counts.get(rule.rule_id) ?? 0).toLocaleString()}</span>
        </div>
      ))}
      {newSelected && (
        <div className="flex items-center gap-1.5 h-7 px-1.5 rounded-md native-selected">
          <span className="w-3" />
          <span className="truncate flex-1 italic">New Rule</span>
        </div>
      )}
      <div className="mt-1 flex flex-col">
        <AddButton onClick={onNew}>New Rule</AddButton>
        {onNewFromFilter && <AddButton onClick={onNewFromFilter}>New Rule from Current Filter</AddButton>}
      </div>
    </div>
  );
}

// ── The editor ───────────────────────────────────────────────────────────────

const sectionTitle = "text-xs font-semibold text-neutral-400 uppercase tracking-wide";

function RuleEditor({
  editing,
  plan,
  files,
  env,
  columns,
  properties,
  valuesFor,
  onCreateProperty,
  onChange,
  onChangeDef,
}: {
  editing: Editing;
  plan: RulePlan | null;
  files: FileRecord[];
  env: RuleEnv;
  columns: FilterColumn[];
  properties: { name: string; type: ValueType }[];
  valuesFor: (columnId: string) => string[];
  onCreateProperty: (name: string, type: ValueType) => Promise<boolean>;
  onChange: (patch: Partial<Editing>) => void;
  onChangeDef: (patch: Partial<RuleDefinition>) => void;
}) {
  const { def } = editing;
  const first = columns[0];
  const slots = ruleSlots(def);

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <input
          value={editing.name}
          onChange={(e) => onChange({ name: e.target.value })}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Rule name"
          className={`${popoverField} flex-1 text-sm font-medium`}
        />
        <label
          className="flex items-center gap-1.5 text-neutral-300 shrink-0"
          title="Runs by itself whenever the location's files load or change (new files from a refresh, and edits)"
        >
          <input type="checkbox" checked={editing.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          Keep running
        </label>
      </div>

      {/* When */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <p className={sectionTitle}>When</p>
          {def.conditions.length > 1 && (
            <select
              value={def.match}
              onChange={(e) => onChangeDef({ match: e.target.value as FilterMatch })}
              className={popoverSelect}
            >
              <option value="all">all of these hold</option>
              <option value="any">any of these holds</option>
            </select>
          )}
        </div>
        {def.conditions.length === 0 && <p className="text-neutral-500">Every file. Add a condition to narrow it down.</p>}
        <ConditionRows
          columns={columns}
          rules={def.conditions}
          onChange={(conditions) => onChangeDef({ conditions })}
          valuesFor={valuesFor}
          removeLabel="Remove condition"
        />
        {first && (
          <AddButton onClick={() => onChangeDef({ conditions: [...def.conditions, newRule(first.id, first.kind)] })}>
            Add Condition
          </AddButton>
        )}
      </section>

      <ExamplePicker def={def} files={files} env={env} columns={columns} onChangeDef={onChangeDef} />

      {/* Then */}
      <section className="flex flex-col gap-2">
        <p className={sectionTitle}>Then set</p>
        {def.actions.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            slots={slots}
            columns={columns}
            properties={properties}
            valuesFor={valuesFor}
            onCreateProperty={onCreateProperty}
            onChange={(patch) => onChangeDef({ actions: def.actions.map((a) => (a.id === action.id ? { ...a, ...patch } : a)) })}
            onRemove={() => onChangeDef({ actions: def.actions.filter((a) => a.id !== action.id) })}
          />
        ))}
        <AddButton onClick={() => onChangeDef({ actions: [...def.actions, newAction()] })}>Add Value to Set</AddButton>
      </section>

      {plan && (def.actions.some((a) => a.property) ? <Preview plan={plan} columns={columns} /> : <PreviewHint />)}
    </div>
  );
}

const NEW_PROPERTY = "__new_property";

const TYPE_CHOICES: { type: ValueType; label: string }[] = [
  { type: "free_text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "enum", label: "Select" },
  { type: "array", label: "Multi-select" },
];

/**
 * A new property's likely type: from how its value is read (a date format, a
 * number), from the part of a column it takes (a date → Date, every folder →
 * Multi-select, one folder or a month's name → Select), Select for typed-in
 * values, Text otherwise.
 */
function guessType(action: RuleAction, columns: FilterColumn[]): ValueType {
  if (action.format === "number") return "number";
  if (action.format) return "date";
  if (action.mode === "column") {
    const kind = columns.find((c) => c.id === action.value)?.kind;
    if (kind === "date") return action.part === "date" || !action.part ? "date" : action.part === "year" || action.part === "month" ? "free_text" : "enum";
    if (kind === "list") return action.part === "all" ? "array" : "enum";
    if (kind === "number") return "number";
    return "free_text";
  }
  return action.mode === "fixed" ? "enum" : "free_text";
}

/** A new property's name from a "from property" action: the part taken (Year, Folder), or the column's own name. */
function suggestedName(action: RuleAction, columns: FilterColumn[]): string {
  const column = columns.find((c) => c.id === action.value);
  if (!column) return "";
  const byPart: Record<string, string> = { year: "Year", month: "Month", monthName: "Month", yearMonth: "Month", quarter: "Quarter", weekday: "Weekday" };
  if (action.part && byPart[action.part]) return byPart[action.part];
  if (action.value === "tags") return action.part === "all" ? "Folders" : "Folder";
  return column.label;
}

const LIST_PARTS: [string, string][] = [
  ["all", "all of them"],
  ["first", "the first"],
  ["n:2", "the 2nd"],
  ["n:3", "the 3rd"],
  ["last", "the last"],
];
// Source Tags are folders, top first
const FOLDER_PARTS: [string, string][] = [
  ["last", "the folder it's in"],
  ["first", "the top folder"],
  ["n:2", "the 2nd folder"],
  ["n:3", "the 3rd folder"],
  ["all", "every folder"],
];
const DATE_PARTS: [string, string][] = [
  ["date", "the date"],
  ["year", "the year"],
  ["month", "the month (01–12)"],
  ["monthName", "the month's name"],
  ["yearMonth", "year and month"],
  ["quarter", "the quarter"],
  ["weekday", "the weekday"],
];

function partsFor(columnId: string, kind: string | undefined): [string, string][] {
  if (columnId === "tags") return FOLDER_PARTS;
  if (kind === "list") return LIST_PARTS;
  if (kind === "date") return DATE_PARTS;
  return [];
}

function ActionRow({
  action,
  slots,
  columns,
  properties,
  valuesFor,
  onCreateProperty,
  onChange,
  onRemove,
}: {
  action: RuleAction;
  slots: string[];
  columns: FilterColumn[];
  properties: { name: string; type: ValueType }[];
  valuesFor: (columnId: string) => string[];
  onCreateProperty: (name: string, type: ValueType) => Promise<boolean>;
  onChange: (patch: Partial<RuleAction>) => void;
  onRemove: () => void;
}) {
  const sourceKind = action.mode === "column" ? columns.find((c) => c.id === action.value)?.kind : undefined;
  /** Then set ▸ New Property…, while its name and type are being chosen. */
  const [creating, setCreating] = useState<{ name: string; type: ValueType; error?: string } | null>(null);
  async function create() {
    if (!creating) return;
    const name = creating.name.trim();
    if (!name) return;
    if (properties.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      setCreating({ ...creating, error: `“${name}” already exists: choose it from the list` });
      return;
    }
    if (await onCreateProperty(name, creating.type)) {
      onChange({ property: name });
      setCreating(null);
    }
  }
  const type = properties.find((p) => p.name === action.property)?.type;
  const problem = action.mode === "formula" && action.value.trim() ? formulaProblem(action.value) : null;
  const listId = `rule-values-${action.id}`;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <select
          value={creating ? NEW_PROPERTY : action.property}
          onChange={(e) => {
            if (e.target.value === NEW_PROPERTY) {
              // Named after what it takes: the slot ({Date} → Date), or the column's part (Year)
              const partLabel = action.mode === "column" ? suggestedName(action, columns) : "";
              setCreating({ name: action.mode === "slot" ? action.value : partLabel, type: guessType(action, columns) });
            } else {
              setCreating(null);
              onChange({ property: e.target.value });
            }
          }}
          className={`${popoverSelect} w-[130px]`}
        >
          <option value="">Property…</option>
          {properties.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
          <option disabled>──────────</option>
          <option value={NEW_PROPERTY}>New Property…</option>
        </select>
        <select
          value={action.mode}
          onChange={(e) => onChange({ mode: e.target.value as ActionMode, value: "" })}
          className={`${popoverSelect} w-[118px]`}
        >
          <option value="fixed">to</option>
          <option value="slot">from pattern</option>
          <option value="column">from property</option>
          <option value="formula">from formula</option>
        </select>
        {action.mode === "column" ? (
          <>
            <select
              value={action.value}
              onChange={(e) => {
                const kind = columns.find((c) => c.id === e.target.value)?.kind;
                onChange({ value: e.target.value, part: partsFor(e.target.value, kind)[0]?.[0] });
              }}
              className={`${popoverSelect} flex-1 min-w-0`}
            >
              <option value="">Choose a column…</option>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {partsFor(action.value, sourceKind).length > 0 && (
              <select
                value={action.part ?? ""}
                onChange={(e) => onChange({ part: e.target.value })}
                className={`${popoverSelect} w-[140px]`}
              >
                {partsFor(action.value, sourceKind).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </>
        ) : action.mode === "slot" ? (
          <select
            value={action.value}
            // A slot named after a date format ({YYMMDD}) is read as one
            onChange={(e) => onChange({ value: e.target.value, ...(formatForSlot(e.target.value) ? { format: formatForSlot(e.target.value) } : {}) })}
            className={`${popoverSelect} flex-1 min-w-0`}
          >
            <option value="">{slots.length ? "Choose a slot…" : "Add a pattern first"}</option>
            {slots.map((s) => (
              <option key={s} value={s}>
                {`{${s}}`}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              value={action.value}
              list={action.mode === "fixed" ? listId : undefined}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder={action.mode === "formula" ? 'upper(slice(name, 3, 7))' : "Value"}
              spellCheck={false}
              className={`${popoverField} flex-1 min-w-0 ${action.mode === "formula" ? "font-mono text-[12px]" : ""}`}
            />
            {action.mode === "fixed" && action.property && (
              <datalist id={listId}>
                {valuesFor(`prop:${action.property}`).map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            )}
          </>
        )}
        {(action.mode === "slot" || action.mode === "formula" || (action.mode === "column" && sourceKind === "text")) && (
          <select
            value={action.format ?? ""}
            onChange={(e) => onChange({ format: e.target.value })}
            title="How to read the text before writing it"
            className={`${popoverSelect} w-[104px]`}
          >
            <option value="">as it is</option>
            <option value="number">as a number</option>
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                as {f}
              </option>
            ))}
          </select>
        )}
        <label
          className="flex items-center gap-1 text-neutral-400 shrink-0"
          title={type === "array" ? "Replace the values instead of adding to them" : "Write over a value that's already there"}
        >
          <input type="checkbox" checked={!!action.overwrite} onChange={(e) => onChange({ overwrite: e.target.checked })} />
          Overwrite
        </label>
        <RemoveButton label="Remove" onClick={onRemove} />
      </div>
      {creating && (
        <div className="flex items-center gap-1.5 pl-[0px] mt-1">
          <span className="text-neutral-400 shrink-0">New property:</span>
          <input
            autoFocus
            value={creating.name}
            placeholder="Name"
            onChange={(e) => setCreating({ ...creating, name: e.target.value, error: undefined })}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setCreating(null);
              }
            }}
            className={`${popoverField} w-[160px]`}
          />
          <select
            value={creating.type}
            onChange={(e) => setCreating({ ...creating, type: e.target.value as ValueType })}
            className={`${popoverSelect} w-[118px]`}
          >
            {TYPE_CHOICES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!creating.name.trim()}
            onClick={() => void create()}
            className="h-6 px-3 rounded-[6px] text-sm bg-blue-500 text-white disabled:bg-neutral-700/70 disabled:text-neutral-500"
          >
            Create
          </button>
          <button type="button" onClick={() => setCreating(null)} className="h-6 px-2 rounded-[6px] text-neutral-400 hover:text-neutral-100">
            Cancel
          </button>
          {creating.error && <span className="text-[11px] text-red-500 truncate">{creating.error}</span>}
        </div>
      )}
      {problem && <p className="pl-[254px] text-[11px] text-red-500">{problem}</p>}
      {action.mode === "formula" && !problem && (
        <p className="pl-[254px] text-[11px] text-neutral-500" title={Object.values(FORMULA_FUNCTIONS).map((f) => f.help).join("\n")}>
          Names: name, filename, ext, path, folder, created, modified, kind, size, {"{Slot}"}, prop("Any Column"); folder(1) is the top
          folder. Join with &. Hover for functions.
        </p>
      )}
    </div>
  );
}

// ── Pick from an example ─────────────────────────────────────────────────────

/**
 * Character offset of a selection point inside `root`'s text. The point may be
 * in a text node, or (at the text's edges) an element with a child index, so
 * it's measured as the length of the text from root's start up to it.
 */
function textOffset(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  return range.toString().length;
}

/**
 * Select part of a matching file's name and name it: the rule's Name pattern
 * is rewritten around the picked parts, and tried on every file at once.
 */
function ExamplePicker({
  def,
  files,
  env,
  columns,
  onChangeDef,
}: {
  def: RuleDefinition;
  files: FileRecord[];
  env: RuleEnv;
  columns: FilterColumn[];
  onChangeDef: (patch: Partial<RuleDefinition>) => void;
}) {
  // Which column the example comes from: the name, a folder (Source Tags), the path, a property…
  const source = def.example?.column ?? "name";
  const sourceLabel = columns.find((c) => c.id === source)?.label ?? "Name";
  const isList = columns.find((c) => c.id === source)?.kind === "list";
  // On a list (Source Tags…): which of its items, such as the folder the file is in
  const item = isList ? (def.example?.item ?? "any") : undefined;
  const isPattern = (c: { column: string; op: string }) => c.column === source && c.op === "matches";

  /** A file's texts to pick from in the source column: its name (without extension), the chosen folder(s), or the value. */
  const textsOf = (f: FileRecord): string[] => {
    if (source === "name") return [baseName(f.file_path)];
    const v = env.valueOf(f, source);
    if (Array.isArray(v)) return listItems(v.map(valueToText).filter(Boolean), item);
    return [valueToText(v)].filter(Boolean);
  };

  // Examples: every distinct text from the files meeting the conditions other than this column's pattern
  const { allExamples, fromFiles } = useMemo(() => {
    const others = def.conditions.filter((c) => !isPattern(c));
    const out: { text: string; label: string }[] = [];
    const seen = new Set<string>();
    let fromFiles = 0;
    for (const f of files) {
      const results = others.map((c) => matchesRule(env.valueOf(f, c.column), env.kindOf(c.column), c));
      if (others.length > 0 && !(def.match === "any" ? results.some(Boolean) : results.every(Boolean))) continue;
      fromFiles++;
      for (const text of textsOf(f)) {
        if (seen.has(text)) continue;
        seen.add(text);
        out.push({ text, label: source === "name" ? fileName(f.file_path) : `${text}  ·  ${fileName(f.file_path)}` });
      }
    }
    out.sort((a, b) => a.text.localeCompare(b.text, undefined, { numeric: true }));
    return { allExamples: out, fromFiles };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.conditions, def.match, files, env, source, item]);
  // Typed into the search box: narrows the examples offered
  const [find, setFind] = useState("");
  const examples = useMemo(() => {
    const q = find.trim().toLowerCase();
    return (q ? allExamples.filter((x) => x.label.toLowerCase().includes(q)) : allExamples).slice(0, 500);
  }, [allExamples, find]);

  const [open, setOpen] = useState(!!def.example);
  const exampleName = def.example?.name || examples[0]?.text || "";
  const slots = def.example?.name === exampleName ? (def.example?.slots ?? []) : [];
  const [pending, setPending] = useState<{ start: number; end: number; name: string } | null>(null);
  const textRef = useRef<HTMLDivElement>(null);

  /** Rewrites the Name pattern from the picks; with none left, the pattern they made goes too. */
  function apply(name: string, next: ExampleSlot[]) {
    const existing = def.conditions.find(isPattern);
    let conditions = def.conditions;
    if (next.length > 0) {
      const pattern = examplePattern(name, next);
      // The pattern goes on the same folder the example came from
      const onItem = item && item !== "any" ? { item } : { item: undefined };
      conditions = existing
        ? def.conditions.map((c) => (c === existing ? { ...c, value: pattern, ...onItem } : c))
        : [...def.conditions, { ...newRule(source, env.kindOf(source)), op: "matches" as const, value: pattern, ...onItem }];
    } else if (existing && existing.value === examplePattern(name, slots)) {
      conditions = def.conditions.filter((c) => c !== existing);
    }
    onChangeDef({ conditions, example: { name, slots: next, column: source, item } });
  }

  /** The selection in the name, as character offsets (null if there's none there). */
  function selectedRange(): { start: number; end: number } | null {
    const sel = window.getSelection();
    const root = textRef.current;
    if (!sel || sel.isCollapsed || !root || !sel.anchorNode || !sel.focusNode || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    // A drag running past the box still selects within it: clamp to its text
    if (!root.contains(range.commonAncestorContainer) && !range.intersectsNode(root)) return null;
    const startIn = root.contains(range.startContainer);
    const endIn = root.contains(range.endContainer);
    const start = startIn ? textOffset(root, range.startContainer, range.startOffset) : 0;
    const end = endIn ? textOffset(root, range.endContainer, range.endOffset) : exampleName.length;
    return end > start ? { start, end } : null;
  }

  // The press starts in the name; the release may land anywhere, so it's caught on the window
  function onMouseDown() {
    const onUp = () => {
      window.removeEventListener("mouseup", onUp);
      // After the browser has settled the selection
      requestAnimationFrame(() => {
        const picked = selectedRange();
        if (!picked) return;
        const taken = new Set(slots.filter((s) => !(picked.start < s.end && picked.end > s.start)).map((s) => s.name.toLowerCase()));
        // Re-picking over a part replaces it, keeping its name
        const replaced = slots.find((s) => picked.start < s.end && picked.end > s.start);
        let n = 1;
        while (taken.has(`part ${n}`)) n++;
        setPending({ ...picked, name: replaced?.name ?? (taken.size === 0 ? "Code" : `Part ${n}`) });
      });
    };
    window.addEventListener("mouseup", onUp);
  }

  function addPending() {
    if (!pending) return;
    const name = pending.name.trim().replace(/[{}:]/g, "");
    const kept = slots.filter((s) => !(pending.start < s.end && pending.end > s.start));
    if (!name || kept.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
    apply(exampleName, [...kept, { name, start: pending.start, end: pending.end }]);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          disabled={files.length === 0}
          onClick={() => setOpen(true)}
          className="h-6 px-1.5 -ml-1.5 rounded-[6px] text-blue-400 hover:bg-neutral-700/40 disabled:text-neutral-500"
        >
          Take a value from the name, a folder or another column: pick it in an example…
        </button>
      </div>
    );
  }

  // The name as segments: picked parts highlighted, and the part being named outlined
  const segments: { text: string; slot?: ExampleSlot; pending?: boolean }[] = [];
  const marks: (ExampleSlot & { pending?: boolean })[] = [
    ...slots.filter((s) => !pending || !(pending.start < s.end && pending.end > s.start)),
    ...(pending ? [{ ...pending, pending: true }] : []),
  ].sort((x, y) => x.start - y.start);
  let pos = 0;
  for (const s of marks) {
    if (s.start > pos) segments.push({ text: exampleName.slice(pos, s.start) });
    segments.push({ text: exampleName.slice(s.start, s.end), slot: s.pending ? undefined : s, pending: s.pending });
    pos = s.end;
  }
  if (pos < exampleName.length) segments.push({ text: exampleName.slice(pos) });

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-neutral-700/60 p-3 min-w-0">
      <p className={sectionTitle}>Pick from an example</p>
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <select
          value={source}
          onChange={(e) => onChangeDef({ example: { name: "", slots: [], column: e.target.value } })}
          title="The column to take the value from"
          className={`${popoverSelect} w-[130px] shrink-0`}
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {isList && (
          <select
            value={item}
            onChange={(e) => onChangeDef({ example: { name: "", slots: [], column: source, item: e.target.value } })}
            title="Which of them to pick from"
            className={`${popoverSelect} w-[150px] shrink-0`}
          >
            {itemChoices(source).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        )}
        <input
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find an example…"
          title="Narrow the examples to ones containing this text"
          className={`${popoverField} w-[140px] shrink-0`}
        />
        <select
          value={exampleName}
          onChange={(e) => onChangeDef({ example: { name: e.target.value, slots: [], column: source, item } })}
          title="The example to pick from"
          className={`${popoverSelect} flex-1 min-w-[160px]`}
        >
          {!examples.some((x) => x.text === exampleName) && exampleName && <option value={exampleName}>{exampleName}</option>}
          {examples.map((x) => (
            <option key={x.text} value={x.text}>
              {x.label}
            </option>
          ))}
        </select>
      </div>
      <p className="text-neutral-500 text-xs">
        {`${allExamples.length.toLocaleString()} different ${source === "tags" ? "folder names" : `${sourceLabel} values`} from the ${fromFiles.toLocaleString()} files meeting the other conditions${
          find.trim() ? ` · ${examples.length.toLocaleString()} containing “${find.trim()}”` : ""
        }${examples.length >= 500 ? " (first 500: type to narrow)" : ""}. Add a condition above to narrow them.`}
      </p>
      <p className="text-neutral-500">
        {examples.length === 0
          ? find.trim()
            ? `No example contains “${find.trim()}”.`
            : `No file has a ${sourceLabel} to pick from.`
          : `Select the part of the ${source === "tags" ? "folder name" : sourceLabel} you want, then name it.${
              isList && item === "any" ? " Any one that fits counts; choose a particular one to narrow it." : ""
            }`}
      </p>
      <div
        ref={textRef}
        onMouseDown={onMouseDown}
        className="font-mono text-[15px] leading-7 px-2 py-1 rounded-md bg-neutral-850 select-text cursor-text whitespace-pre-wrap break-all"
      >
        {segments.map((seg, i) =>
          seg.slot ? (
            <span key={i} title={`{${seg.slot.name}}`} className="rounded-sm bg-blue-500/25 text-blue-300 outline outline-1 outline-blue-500/50">
              {seg.text}
            </span>
          ) : seg.pending ? (
            <span key={i} className="rounded-sm outline-dashed outline-1 outline-blue-500">
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </div>
      {pending && (
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-400">
            Name “<span className="font-mono text-neutral-100">{exampleName.slice(pending.start, pending.end)}</span>”:
          </span>
          <input
            autoFocus
            value={pending.name}
            onChange={(e) => setPending({ ...pending, name: e.target.value })}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPending();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setPending(null);
              }
            }}
            className={`${popoverField} w-[160px]`}
          />
          <button
            type="button"
            disabled={!pending.name.trim()}
            onClick={addPending}
            className="h-6 px-3 rounded-[6px] text-sm bg-blue-500 text-white disabled:bg-neutral-700/70 disabled:text-neutral-500"
          >
            Add
          </button>
          <button type="button" onClick={() => setPending(null)} className="h-6 px-2 rounded-[6px] text-neutral-400 hover:text-neutral-100">
            Cancel
          </button>
        </div>
      )}
      {slots.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {slots.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1 h-5 pl-1.5 pr-0.5 rounded bg-blue-500/15 text-[12px]">
              <span className="font-mono">{`{${s.name}}`}</span>
              <span className="text-neutral-500">= {exampleName.slice(s.start, s.end)}</span>
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                onClick={() => apply(exampleName, slots.filter((x) => x !== s))}
                className="w-4 h-4 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-100"
              >
                <SymbolIcon name="xmark" size={8} fallback="×" />
              </button>
            </span>
          ))}
          <span className="text-neutral-500 text-xs">The Name pattern above is rewritten as you pick; edit it there to fine-tune.</span>
        </div>
      )}
    </section>
  );
}

// ── Preview ──────────────────────────────────────────────────────────────────

/** Preview rows shown at first, and added each time it's scrolled to the bottom. */
const PREVIEW_ROWS = 100;
const PREVIEW_COLUMNS = ["File", "Read from", "Picked out", "Result"];
const PREVIEW_WIDTHS = [220, 240, 200, 300];

function show(v: unknown): string {
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return "empty";
  return Array.isArray(v) ? v.map(valueToText).join(", ") : valueToText(v);
}

/** Shown until some value has a property to go into. */
function PreviewHint() {
  return (
    <section className="flex flex-col gap-2">
      <p className={sectionTitle}>Preview</p>
      <p className="text-neutral-500">Choose a property to set (or make a new one) to see what the rule would do.</p>
    </section>
  );
}

type PreviewFilter = "all" | PreviewStatus;

/**
 * What the rule would do, file by file: what it read (the folder or name a
 * pattern fitted, a column it copies), what its patterns picked out, and the
 * result. Narrow it to one outcome to check those files.
 */
function Preview({ plan, columns }: { plan: RulePlan; columns: FilterColumn[] }) {
  const { counts } = plan;
  const [only, setOnly] = useState<PreviewFilter>("all");
  const [limit, setLimit] = useState(PREVIEW_ROWS);
  const [widths, setWidths] = useState<number[]>(() => {
    const saved = loadSize<number[]>("rules-preview-columns", PREVIEW_WIDTHS);
    return Array.isArray(saved) && saved.length === PREVIEW_WIDTHS.length ? saved : PREVIEW_WIDTHS;
  });
  const order = { change: 0, nomatch: 1, edited: 2, set: 3 } as const;
  const shown = plan.rows.filter((r) => only === "all" || r.status === only);
  const rows = [...shown].sort((a, b) => order[a.status] - order[b.status]).slice(0, limit);
  // Scrolling to the bottom brings in the next rows
  const endRef = useRef<HTMLDivElement>(null);
  const more = shown.length > limit;
  useEffect(() => {
    const el = endRef.current;
    if (!el || !more) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PREVIEW_ROWS);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, rows.length]);
  const labelOf = (id: string) => columns.find((c) => c.id === id)?.label ?? id;
  const tabs: [PreviewFilter, string, number][] = [
    ["all", "All", plan.rows.length],
    ["change", "Will change", counts.change],
    ["nomatch", "No match", counts.nomatch],
    ["set", "Already set", counts.set],
    ["edited", "Changed by hand", counts.edited],
  ];
  // Columns are as wide as dragged; the table scrolls sideways when they don't fit
  const gridStyle = { gridTemplateColumns: widths.map((w) => `${w}px`).join(" ") };
  const grid = "grid gap-x-3";
  const total = widths.reduce((a, b) => a + b, 0) + 12 * (widths.length - 1) + 24;
  return (
    <section className="flex flex-col gap-2 min-w-0">
      <p className={sectionTitle}>Preview</p>
      <p className="text-neutral-300">
        {counts.match.toLocaleString()} {counts.match === 1 ? "file matches" : "files match"} · {counts.change.toLocaleString()} will change ·{" "}
        {counts.set.toLocaleString()} already set
        {counts.edited > 0 && ` · ${counts.edited.toLocaleString()} changed by hand`}
        {counts.nomatch > 0 && ` · ${counts.nomatch.toLocaleString()} no match`}
      </p>
      <div className="flex flex-wrap gap-1">
        {tabs
          .filter(([id, , n]) => id === "all" || n > 0)
          .map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setOnly(id);
                setLimit(PREVIEW_ROWS);
              }}
              className={`h-6 px-2 rounded-[6px] text-xs ${only === id ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800"}`}
            >
              {label} <span className="tabular-nums opacity-70">{n.toLocaleString()}</span>
            </button>
          ))}
      </div>
      {rows.length > 0 && (
        <div className="rounded-lg border border-neutral-700/60 overflow-x-auto min-w-0">
          <div style={{ minWidth: total }}>
          <div style={gridStyle} className={`${grid} px-3 py-1 text-xs text-neutral-500 border-b border-neutral-700/60 sticky top-0 bg-neutral-900`}>
            {PREVIEW_COLUMNS.map((label, i) => (
              // Only the label is clipped: the grip sits on the boundary, just outside the cell
              <span key={label} className="relative min-w-0">
                <span className="block truncate">{label}</span>
                {/* Drag a header's right edge to resize its column */}
                <span
                  onMouseDown={(e) =>
                    dragWidth(e, widths[i], 80, 900, 1, (w, done) => {
                      setWidths((ws) => {
                        const next = ws.map((x, j) => (j === i ? w : x));
                        if (done) saveSize("rules-preview-columns", next);
                        return next;
                      });
                    })
                  }
                  onDoubleClick={() =>
                    setWidths((ws) => {
                      const next = ws.map((x, j) => (j === i ? PREVIEW_WIDTHS[i] : x));
                      saveSize("rules-preview-columns", next);
                      return next;
                    })
                  }
                  title="Drag to resize; double-click to reset"
                  className="group/grip absolute -right-[11px] -top-1 -bottom-1 w-[10px] flex justify-center cursor-col-resize z-10"
                >
                  <span className="w-px h-full bg-neutral-700/60 group-hover/grip:bg-blue-500 group-hover/grip:w-[2px]" />
                </span>
              </span>
            ))}
          </div>
          {rows.map((row, i) => {
            const read = row.sources.map((x) => `${labelOf(x.column)}: ${x.text || "empty"}`).join("  ·  ");
            const picked = Object.entries(row.slots)
              .map(([k, v]) => `${k} ${v}`)
              .join("  ·  ");
            const result =
              row.status === "change"
                ? row.changes.map((c) => `${c.property}${show(c.from) === "empty" ? "" : ` ${show(c.from)}`} → ${show(c.to)}`).join("  ·  ")
                : row.status === "set"
                  ? "already set"
                  : row.status === "edited"
                    ? "changed by hand: left as it is"
                    : `no match: ${row.problems.join("; ")}`;
            return (
              <div key={row.file.file_id} style={gridStyle} className={`${grid} items-baseline px-3 py-1 ${i % 2 ? "bg-neutral-850" : ""}`}>
                <span className="truncate" title={row.file.relative_path ?? fileName(row.file.file_path)}>
                  {fileName(row.file.file_path)}
                </span>
                <span className="truncate text-neutral-400" title={read}>
                  {row.sources.map((x, j) => (
                    <span key={j} className="mr-2">
                      <span className="text-neutral-500">{labelOf(x.column)}</span> {x.text || "empty"}
                    </span>
                  ))}
                </span>
                <span className="truncate text-neutral-300 font-mono text-[12px]" title={picked}>
                  {Object.entries(row.slots).map(([k, v]) => (
                    <span key={k} className="mr-2">
                      <span className="text-neutral-500">{k}</span> {v}
                    </span>
                  ))}
                </span>
                <span
                  className={`truncate ${row.status === "change" ? "text-blue-400" : row.status === "nomatch" ? "text-amber-500" : "text-neutral-400"}`}
                  title={result}
                >
                  {result}
                </span>
              </div>
            );
          })}
          {more && (
            <div ref={endRef} className="px-3 py-1 text-neutral-500">
              Showing {rows.length.toLocaleString()} of {shown.length.toLocaleString()}: scroll for more
            </div>
          )}
          </div>
        </div>
      )}
    </section>
  );
}
