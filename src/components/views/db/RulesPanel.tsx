import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { popoverField, popoverSelect } from "../../shared/Popover";
import { SymbolIcon } from "../../../lib/fileIcons";
import { matchesRule, newRule, type FilterMatch } from "../../../lib/dbTable";
import { dropIndexAt, moveColumnId } from "../../../lib/columns";
import { baseName, fileName } from "../../../lib/fileColumns";
import { formulaProblem, FORMULA_FUNCTIONS } from "../../../lib/formula";
import { DATE_FORMATS, examplePattern, type ExampleSlot } from "../../../lib/patterns";
import { valueToText } from "../../../lib/propertyTypes";
import {
  emptyDefinition,
  newAction,
  parseDefinition,
  planRule,
  ruleSlots,
  type ActionMode,
  type RuleAction,
  type RuleDefinition,
  type RuleEnv,
  type RulePlan,
  type StoredRule,
} from "../../../lib/rules";
import { AddButton, ConditionRows, RemoveButton, type FilterColumn } from "./FilterSortPopover";
import type { FileRecord, ValueType } from "../../../types";

interface Props {
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

  function startNew() {
    setSelected(NEW);
    setEditing({ rule_id: "", name: "New Rule", enabled: false, def: emptyDefinition(), dirty: true });
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

  async function remove() {
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
    <div className="absolute right-0 top-0 h-full w-[min(860px,100%)] flex flex-col bg-neutral-900 border-l border-neutral-700/60 shadow-2xl z-50 text-body">
      <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-700/60 shrink-0">
        <h2 className="text-sm font-medium text-neutral-100">Rules</h2>
        <button
          onClick={() => void close()}
          className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200"
          aria-label="Close Rules"
        >
          <SymbolIcon name="xmark" size={11} fallback="✕" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <RuleList
          rules={rules}
          counts={counts}
          selected={selected}
          newSelected={selected === NEW}
          onSelect={(id) => void select(id)}
          onNew={startNew}
          onToggle={(rule) => void props.onSave({ ...rule, enabled: !rule.enabled })}
          onReorder={props.onReorder}
        />

        <div className="flex-1 min-w-0 overflow-y-auto">
          {!editing ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-neutral-500">
              <p>No rule selected.</p>
              <AddButton onClick={startNew}>New Rule</AddButton>
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
      </div>

      {editing && (
        <div className="flex items-center gap-2 px-5 py-3 border-t border-neutral-700/60 shrink-0">
          <button
            type="button"
            onClick={() => void remove()}
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
    </div>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────

function RuleList({
  rules,
  counts,
  selected,
  newSelected,
  onSelect,
  onNew,
  onToggle,
  onReorder,
}: {
  rules: StoredRule[];
  counts: Map<string, number>;
  selected: string | null;
  newSelected: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onToggle: (rule: StoredRule) => void;
  onReorder: (ids: string[]) => Promise<void>;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; target: number } | null>(null);

  function startDrag(e: React.PointerEvent<HTMLElement>, id: string) {
    if (e.button !== 0 || rules.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-rule]") ?? [])];
    const heights = rows.map((r) => r.offsetHeight);
    const top = rows[0]?.getBoundingClientRect().top ?? 0;
    let target = rules.findIndex((r) => r.rule_id === id);
    setDrag({ id, target });
    const onMove = (ev: PointerEvent) => {
      target = dropIndexAt(heights, ev.clientY - top, 0);
      setDrag({ id, target });
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      setDrag(null);
      const ids = rules.map((r) => r.rule_id);
      const order = moveColumnId(ids, id, target);
      if (order.some((x, i) => x !== ids[i])) void onReorder(order);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  const from = drag ? rules.findIndex((r) => r.rule_id === drag.id) : -1;
  const line = drag && drag.target !== from && drag.target !== from + 1 ? drag.target : null;

  return (
    <div ref={listRef} className="w-[230px] shrink-0 border-r border-neutral-700/60 overflow-y-auto py-2 px-2 flex flex-col gap-px">
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
            onPointerDown={(e) => startDrag(e, rule.rule_id)}
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
      <div className="mt-1">
        <AddButton onClick={onNew}>New Rule</AddButton>
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

      <ExamplePicker def={def} files={files} env={env} onChangeDef={onChangeDef} />

      {/* Then */}
      <section className="flex flex-col gap-2">
        <p className={sectionTitle}>Then set</p>
        {def.actions.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            slots={slots}
            properties={properties}
            valuesFor={valuesFor}
            onCreateProperty={onCreateProperty}
            onChange={(patch) => onChangeDef({ actions: def.actions.map((a) => (a.id === action.id ? { ...a, ...patch } : a)) })}
            onRemove={() => onChangeDef({ actions: def.actions.filter((a) => a.id !== action.id) })}
          />
        ))}
        <AddButton onClick={() => onChangeDef({ actions: [...def.actions, newAction()] })}>Add Value to Set</AddButton>
      </section>

      {plan && (def.actions.some((a) => a.property) ? <Preview plan={plan} /> : <PreviewHint />)}
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

/** A new property's likely type: from how its value is read (a date format, a number), else Select for typed-in values, Text otherwise. */
function guessType(action: RuleAction): ValueType {
  if (action.format === "number") return "number";
  if (action.format) return "date";
  return action.mode === "fixed" ? "enum" : "free_text";
}

function ActionRow({
  action,
  slots,
  properties,
  valuesFor,
  onCreateProperty,
  onChange,
  onRemove,
}: {
  action: RuleAction;
  slots: string[];
  properties: { name: string; type: ValueType }[];
  valuesFor: (columnId: string) => string[];
  onCreateProperty: (name: string, type: ValueType) => Promise<boolean>;
  onChange: (patch: Partial<RuleAction>) => void;
  onRemove: () => void;
}) {
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
              // Named after the slot it takes, if any ({Date} → Date)
              setCreating({ name: action.mode === "slot" ? action.value : "", type: guessType(action) });
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
          <option value="formula">from formula</option>
        </select>
        {action.mode === "slot" ? (
          <select value={action.value} onChange={(e) => onChange({ value: e.target.value })} className={`${popoverSelect} flex-1 min-w-0`}>
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
        {action.mode !== "fixed" && (
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
          Names: name, filename, ext, path, folder, {"{Slot}"}, prop("Name"). Join with &. Hover for functions.
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
  onChangeDef,
}: {
  def: RuleDefinition;
  files: FileRecord[];
  env: RuleEnv;
  onChangeDef: (patch: Partial<RuleDefinition>) => void;
}) {
  // Examples: files meeting the conditions other than the pattern
  const candidates = useMemo(() => {
    const others = def.conditions.filter((c) => !(c.column === "name" && c.op === "matches"));
    return files
      .filter((f) => {
        const results = others.map((c) => matchesRule(env.valueOf(f, c.column), env.kindOf(c.column), c));
        return others.length === 0 || (def.match === "any" ? results.some(Boolean) : results.every(Boolean));
      })
      .slice(0, 200);
  }, [def.conditions, def.match, files, env]);

  const [open, setOpen] = useState(!!def.example);
  const exampleName = def.example?.name ?? (candidates[0] ? baseName(candidates[0].file_path) : "");
  const slots = def.example?.name === exampleName ? (def.example?.slots ?? []) : [];
  const [pending, setPending] = useState<{ start: number; end: number; name: string } | null>(null);
  const textRef = useRef<HTMLDivElement>(null);

  /** Rewrites the Name pattern from the picks; with none left, the pattern they made goes too. */
  function apply(name: string, next: ExampleSlot[]) {
    const existing = def.conditions.find((c) => c.column === "name" && c.op === "matches");
    let conditions = def.conditions;
    if (next.length > 0) {
      const pattern = examplePattern(name, next);
      conditions = existing
        ? def.conditions.map((c) => (c === existing ? { ...c, value: pattern } : c))
        : [...def.conditions, { ...newRule("name", "text"), op: "matches" as const, value: pattern }];
    } else if (existing && existing.value === examplePattern(name, slots)) {
      conditions = def.conditions.filter((c) => c !== existing);
    }
    onChangeDef({ conditions, example: { name, slots: next } });
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
          disabled={candidates.length === 0}
          onClick={() => setOpen(true)}
          className="h-6 px-1.5 -ml-1.5 rounded-[6px] text-blue-400 hover:bg-neutral-700/40 disabled:text-neutral-500"
        >
          Take a value from the name: pick it in an example…
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
    <section className="flex flex-col gap-2 rounded-lg border border-neutral-700/60 p-3">
      <div className="flex items-center gap-2">
        <p className={sectionTitle}>Pick from an example</p>
        <select
          value={exampleName}
          onChange={(e) => onChangeDef({ example: { name: e.target.value, slots: [] } })}
          className={`${popoverSelect} ml-auto max-w-[280px]`}
        >
          {!candidates.some((f) => baseName(f.file_path) === exampleName) && exampleName && <option value={exampleName}>{exampleName}</option>}
          {candidates.map((f) => (
            <option key={f.file_id} value={baseName(f.file_path)}>
              {fileName(f.file_path)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-neutral-500">Select the part of the name you want, then name it.</p>
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

const PREVIEW_ROWS = 100;

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

function Preview({ plan }: { plan: RulePlan }) {
  const { counts } = plan;
  const order = { change: 0, nomatch: 1, edited: 2, set: 3 } as const;
  const rows = [...plan.rows].sort((a, b) => order[a.status] - order[b.status]).slice(0, PREVIEW_ROWS);
  return (
    <section className="flex flex-col gap-2">
      <p className={sectionTitle}>Preview</p>
      <p className="text-neutral-300">
        {counts.match.toLocaleString()} {counts.match === 1 ? "file matches" : "files match"} · {counts.change.toLocaleString()} will change ·{" "}
        {counts.set.toLocaleString()} already set
        {counts.edited > 0 && ` · ${counts.edited.toLocaleString()} changed by hand`}
        {counts.nomatch > 0 && ` · ${counts.nomatch.toLocaleString()} no match`}
      </p>
      {rows.length > 0 && (
        <div className="rounded-lg border border-neutral-700/60 overflow-hidden">
          {rows.map((row, i) => (
            <div key={row.file.file_id} className={`flex items-baseline gap-3 px-3 py-1 ${i % 2 ? "bg-neutral-850" : ""}`}>
              <span className="w-[240px] shrink-0 truncate" title={fileName(row.file.file_path)}>
                {fileName(row.file.file_path)}
              </span>
              <span className="flex-1 min-w-0 truncate text-neutral-400">
                {row.status === "change" &&
                  row.changes.map((c, j) => (
                    <span key={j} className="mr-3">
                      <span className="text-neutral-300">{c.property}</span> {show(c.from)} → <span className="text-blue-400">{show(c.to)}</span>
                    </span>
                  ))}
                {row.status === "set" && "already set"}
                {row.status === "edited" && "changed by hand: left as it is"}
                {row.status === "nomatch" && <span className="text-amber-500">no match: {row.problems.join("; ")}</span>}
              </span>
            </div>
          ))}
          {plan.rows.length > PREVIEW_ROWS && (
            <p className="px-3 py-1 text-neutral-500">and {(plan.rows.length - PREVIEW_ROWS).toLocaleString()} more</p>
          )}
        </div>
      )}
    </section>
  );
}
