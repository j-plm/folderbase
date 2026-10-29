import { useEffect, useMemo, useRef, useState } from "react";
import ColumnOptions from "../../shared/ColumnOptions";
import type React from "react";
import { popoverField, popoverSelect } from "../../shared/Popover";
import { SymbolIcon } from "../../../lib/fileIcons";
import { showContextMenu, type MenuEntry } from "../../../lib/nativeMenu";
import { evalFilters, listItems, matchesRule, newRule, type FilterItem, type FilterRule } from "../../../lib/dbTable";
import { filterRules, mapRules, removeItem, updateRule } from "../../../lib/filterTree";
import { dropIndexAt, moveColumnId } from "../../../lib/columns";
import { baseName, fileName } from "../../../lib/fileColumns";
import { formulaProblem } from "../../../lib/formula";
import { DATE_FORMATS, examplePattern, type ExampleSlot } from "../../../lib/patterns";
import { valueToText } from "../../../lib/propertyTypes";
import {
  emptyDefinition,
  formatForSlot,
  newAction,
  parseDefinition,
  planRule,
  ruleSlots,
  withFilterConditions,
  type ActionMode,
  type RuleAction,
  type RuleDefinition,
  type RuleEnv,
  type PreviewStatus,
  type RulePlan,
  type StoredRule,
} from "../../../lib/rules";
import { AddButton, ConditionTree, RemoveButton, newFilterGroup, type FilterColumn } from "./FilterSortPopover";
import RulesHelp, { FormulaHelp, PatternHelp } from "./RulesHelp";
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
  /** The view's current filter as conditions (null: the view isn't filtered). */
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

/** The narrowest the panel can be dragged; the table beside it always keeps at least RULES_TABLE_MIN_WIDTH. */
export const RULES_PANEL_MIN_WIDTH = 400;
/** The strip of table the panel always leaves showing, however wide it's dragged. */
export const RULES_TABLE_MIN_WIDTH = 120;

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
  /** The list of rules beside the editor; hidden, a pop-up in the header picks the rule (more room in a slim panel). */
  const [listShown, setListShownState] = useState(() => loadSize("rules-list-shown", true));
  function setListShown(shown: boolean) {
    setListShownState(shown);
    saveSize("rules-list-shown", shown);
  }
  const panelRef = useRef<HTMLDivElement>(null);

  // Mouse events, not pointer events: after a native menu closes WebKit can still
  // think the button is down and skip the next pointerdown, so the first click did nothing
  function startResize(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelRef.current?.offsetWidth ?? props.width;
    const max = (panelRef.current?.parentElement?.clientWidth ?? window.innerWidth) - RULES_TABLE_MIN_WIDTH;
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

  const previewEnv = useMemo(() => (overHandEdits ? { ...env, overHandEdits: true } : env), [env, overHandEdits]);
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
  /** The rules as a menu, while the list is hidden: choosing one edits it. */
  function showRulePicker() {
    const entries: MenuEntry[] = rules.map((r) => {
      const n = counts.get(r.rule_id);
      return {
        type: "check",
        text: `${r.name}${n != null ? ` — ${n.toLocaleString()} ${n === 1 ? "file" : "files"}` : ""}${r.enabled ? "" : " (off)"}`,
        checked: selected === r.rule_id,
        action: () => void select(r.rule_id),
      };
    });
    if (entries.length > 0) entries.push({ type: "separator" });
    entries.push({ type: "item", text: "New Rule", action: () => startNew() });
    void showContextMenu(entries);
  }

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

  /** Keep running, from the list or the editor: a saved rule saves it at once, so the two always agree. */
  function setEnabled(ruleId: string, enabled: boolean) {
    setEditing((e) => (e && e.rule_id === ruleId ? { ...e, enabled } : e));
    const rule = rules.find((r) => r.rule_id === ruleId);
    if (rule) void props.onSave({ ...rule, enabled });
  }
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
      style={{ width: props.width, maxWidth: `calc(100% - ${RULES_TABLE_MIN_WIDTH}px)` }}
      className="absolute right-0 top-0 h-full flex flex-col bg-neutral-900 border-l border-neutral-700/60 shadow-2xl z-50 text-body"
    >
      {/* Drag the left edge to resize */}
      <div
        onMouseDown={startResize}
        className="absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize z-10"
        aria-hidden
      />
      <div className="flex items-center gap-1 px-3 py-3 border-b border-neutral-700/60 shrink-0">
        <button
          onClick={() => setListShown(!listShown)}
          title={listShown ? "Hide Rules List" : "Show Rules List"}
          aria-label={listShown ? "Hide Rules List" : "Show Rules List"}
          aria-pressed={listShown}
          className={`p-1.5 rounded-[6px] hover:bg-neutral-800 hover:text-neutral-200 ${listShown ? "text-neutral-200" : "text-neutral-400"}`}
        >
          <SymbolIcon name="sidebar.left" size={13} fallback="▤" />
        </button>
        <h2 className="ml-1 shrink-0 text-sm font-medium text-neutral-100">Rules</h2>
        {!listShown && (
          <button
            onClick={showRulePicker}
            title="Choose a Rule"
            className="flex items-center gap-1 min-w-0 h-6 px-2 ml-1 rounded-[6px] text-sm text-neutral-300 hover:bg-neutral-800"
          >
            <span className="text-neutral-500">›</span>
            <span className="truncate">{editing ? editing.name : "No rule selected"}</span>
            <SymbolIcon name="chevron.up.chevron.down" size={9} fallback="⌃" className="shrink-0 text-neutral-400" />
          </button>
        )}
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
        {listShown && (
          <>
            <RuleList
              width={listWidth}
              rules={rules}
              counts={counts}
              selected={selected}
              newSelected={selected === NEW}
              onSelect={(id) => void select(id)}
              onNew={() => startNew()}
              onToggle={(rule) => setEnabled(rule.rule_id, !rule.enabled)}
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
          </>
        )}

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
              viewFilter={props.viewFilter}
              onCreateProperty={props.onCreateProperty}
              onChange={(patch) =>
                patch.enabled !== undefined && editing.rule_id ? setEnabled(editing.rule_id, patch.enabled) : change(patch)
              }
              onChangeDef={changeDef}
              onIncludeHandEdits={() => setOverHandEdits(true)}
            />
          )}
        </div>
        {helpOpen && <RulesHelp onClose={() => setHelpOpen(false)} />}
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-5 py-3 border-t border-neutral-700/60 shrink-0">
          <button
            type="button"
            // A saved rule asks first; an unsaved new one just goes
            onClick={() => (editing.rule_id ? setConfirmDelete(true) : void remove())}
            className="h-6 px-3 rounded-[6px] text-sm bg-red-900 text-red-500"
          >
            {editing.rule_id ? "Delete Rule" : "Discard"}
          </button>
          <label className="flex items-center gap-1.5 ml-3 text-neutral-400" title="Apply Now writes over values you've changed by hand since this rule set them, too">
            <input type="checkbox" checked={overHandEdits} onChange={(e) => setOverHandEdits(e.target.checked)} />
            Include values changed by hand
          </label>
          {error && <span className="text-red-500 text-xs truncate">{error}</span>}
          {/* Kept together at the right, on a line of their own when the panel is narrow */}
          <span className="ml-auto flex items-center gap-2">
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
          </span>
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
            title={rule.enabled ? "Keep running: on (runs whenever files load or change)" : "Keep running: off (runs only with Apply Now)"}
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
  viewFilter,
  onCreateProperty,
  onChange,
  onChangeDef,
  onIncludeHandEdits,
}: {
  editing: Editing;
  plan: RulePlan | null;
  files: FileRecord[];
  env: RuleEnv;
  columns: FilterColumn[];
  properties: { name: string; type: ValueType }[];
  valuesFor: (columnId: string) => string[];
  viewFilter: RuleDefinition | null;
  onCreateProperty: (name: string, type: ValueType) => Promise<boolean>;
  onChange: (patch: Partial<Editing>) => void;
  onChangeDef: (patch: Partial<RuleDefinition>) => void;
  onIncludeHandEdits: () => void;
}) {
  const { def } = editing;
  const first = columns[0];
  const slots = ruleSlots(def);
  const withFilter = viewFilter ? withFilterConditions(def, viewFilter) : def;
  /** The "matches pattern" condition whose example is open beneath it. */
  const [picking, setPicking] = useState<string | null>(null);
  /** The condition or value whose pattern or formula help is open beneath it. */
  const [help, setHelp] = useState<string | null>(null);
  const toggleHelp = (id: string) => setHelp(help === id ? null : id);

  function changeConditions(conditions: FilterItem[]) {
    // A condition just turned into an empty pattern: open its example, as there's nothing to go on yet
    const before = filterRules(def.conditions);
    const turned = filterRules(conditions).find(
      (c) => c.op === "matches" && !c.value.trim() && before.find((o) => o.id === c.id)?.op !== "matches"
    );
    if (turned) setPicking(turned.id);
    onChangeDef({ conditions });
  }

  function addPatternFromExample() {
    const condition: FilterRule = { ...newRule("name", env.kindOf("name")), op: "matches", value: "" };
    onChangeDef({ conditions: [...def.conditions, condition] });
    setPicking(condition.id);
  }

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
        <p className={sectionTitle}>When</p>
        {def.conditions.length === 0 && <p className="text-neutral-500">Every file. Add a condition to narrow it down.</p>}
        <ConditionTree
          columns={columns}
          items={def.conditions}
          match={def.match}
          onChange={changeConditions}
          onMatchChange={(match) => onChangeDef({ match })}
          valuesFor={valuesFor}
          noun="Condition"
          rowAction={(rule) =>
            rule.op === "matches" && (
              <>
                <RowToggle
                  label="Pick from an Example"
                  icon="character.cursor.ibeam"
                  fallback="I"
                  on={picking === rule.id}
                  disabled={files.length === 0}
                  onClick={() => setPicking(picking === rule.id ? null : rule.id)}
                />
                <RowToggle label="Pattern Help" icon="questionmark.circle" fallback="?" on={help === rule.id} onClick={() => toggleHelp(rule.id)} />
              </>
            )
          }
          below={(rule) =>
            rule.op === "matches" && (
              <>
                {picking === rule.id && (
                  <ExamplePicker
                    def={def}
                    condition={rule}
                    files={files}
                    env={env}
                    columns={columns}
                    onChangeDef={onChangeDef}
                    onClose={() => setPicking(null)}
                  />
                )}
                {help === rule.id && (
                  <PatternHelp
                    condition={rule}
                    files={files}
                    env={env}
                    onUse={(value) => onChangeDef({ conditions: updateRule(def.conditions, rule.id, { value }) })}
                    onClose={() => setHelp(null)}
                  />
                )}
              </>
            )
          }
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {first && (
            <AddButton onClick={() => onChangeDef({ conditions: [...def.conditions, newRule(first.id, first.kind)] })}>
              Add Condition
            </AddButton>
          )}
          {first && (
            <AddButton onClick={() => onChangeDef({ conditions: [...def.conditions, newFilterGroup(def.match, first)] })}>
              Add Condition Group
            </AddButton>
          )}
          {withFilter !== def && (
            <AddButton onClick={() => onChangeDef({ match: withFilter.match, conditions: withFilter.conditions })}>
              Add Current Filter
            </AddButton>
          )}
          {files.length > 0 && <AddButton onClick={addPatternFromExample}>Add Pattern from an Example</AddButton>}
        </div>
      </section>

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
            helpOpen={help === action.id}
            onToggleHelp={() => toggleHelp(action.id)}
            help={
              <FormulaHelp
                formula={action.value}
                // Files meeting the conditions: not the ones whose name doesn't fit the pattern
                rows={plan?.rows.filter((r) => !r.problems.includes("doesn't fit the pattern")) ?? []}
                env={env}
                onUse={(value) => onChangeDef({ actions: def.actions.map((a) => (a.id === action.id ? { ...a, value } : a)) })}
                onClose={() => setHelp(null)}
              />
            }
          />
        ))}
        <AddButton onClick={() => onChangeDef({ actions: [...def.actions, newAction()] })}>Add Value to Set</AddButton>
      </section>

      {plan &&
        (def.actions.some((a) => a.property) ? (
          <Preview plan={plan} columns={columns} onIncludeHandEdits={onIncludeHandEdits} />
        ) : (
          <PreviewHint />
        ))}
    </div>
  );
}

/** A small on/off button at the end of a row (Pick from an Example, help). */
function RowToggle({
  label,
  icon,
  fallback,
  on,
  disabled,
  onClick,
}: {
  label: string;
  icon: string;
  fallback: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`w-5 h-5 shrink-0 flex items-center justify-center rounded ${
        on ? "bg-blue-500/25 text-blue-300" : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/60"
      }`}
    >
      <SymbolIcon name={icon} size={12} fallback={fallback} />
    </button>
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
    if (kind === "date") {
      if (action.part === "date" || action.part === "dateTime" || !action.part) return "date";
      return ["year", "month", "time", "hour"].includes(action.part) ? "free_text" : "enum";
    }
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
  const byPart: Record<string, string> = { year: "Year", month: "Month", monthName: "Month", yearMonth: "Month", quarter: "Quarter", weekday: "Weekday", time: "Time", hour: "Hour" };
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
// Path Tags are folders, top first
const FOLDER_PARTS: [string, string][] = [
  ["last", "the folder it's in"],
  ["first", "the top folder"],
  ["n:2", "the 2nd folder"],
  ["n:3", "the 3rd folder"],
  ["all", "every folder"],
];
const DATE_PARTS: [string, string][] = [
  ["date", "the date"],
  ["dateTime", "the date and time"],
  ["time", "the time"],
  ["hour", "the hour"],
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
  helpOpen,
  onToggleHelp,
  help,
}: {
  action: RuleAction;
  slots: string[];
  columns: FilterColumn[];
  properties: { name: string; type: ValueType }[];
  valuesFor: (columnId: string) => string[];
  onCreateProperty: (name: string, type: ValueType) => Promise<boolean>;
  onChange: (patch: Partial<RuleAction>) => void;
  onRemove: () => void;
  /** Formula help, shown under the row while open. */
  helpOpen: boolean;
  onToggleHelp: () => void;
  help: React.ReactNode;
}) {
  const sourceKind = action.mode === "column" ? columns.find((c) => c.id === action.value)?.kind : undefined;
  /** For "same": what files can share, everything but the property being set. */
  const sameChoices = columns.filter((c) => c.id !== `prop:${action.property}`);
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
    <div className="@container flex flex-col gap-0.5">
      {/* Narrow: what it's set from wraps onto a line of its own */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
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
          className={`${popoverSelect} w-[130px] min-w-0 @max-[30rem]:grow`}
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
          onChange={(e) => onChange({ mode: e.target.value as ActionMode, value: "", also: undefined })}
          className={`${popoverSelect} w-[118px] min-w-0 @max-[30rem]:grow`}
        >
          <option value="fixed">to</option>
          <option value="slot">from pattern</option>
          <option value="column">from property</option>
          <option value="formula">from formula</option>
          <option value="same">from files with the same</option>
        </select>
        {action.mode === "same" ? (
          <select value={action.value} onChange={(e) => onChange({ value: e.target.value })} className={`${popoverSelect} flex-1 min-w-[140px]`}>
            <option value="">Choose a property…</option>
            <ColumnOptions columns={sameChoices} />
          </select>
        ) : action.mode === "column" ? (
          <>
            <select
              value={action.value}
              onChange={(e) => {
                const kind = columns.find((c) => c.id === e.target.value)?.kind;
                onChange({ value: e.target.value, part: partsFor(e.target.value, kind)[0]?.[0] });
              }}
              className={`${popoverSelect} flex-1 min-w-[140px]`}
            >
              <option value="">Choose a column…</option>
              <ColumnOptions columns={columns} />
            </select>
            {partsFor(action.value, sourceKind).length > 0 && (
              <select
                value={action.part ?? ""}
                onChange={(e) => onChange({ part: e.target.value })}
                className={`${popoverSelect} shrink-0`}
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
            className={`${popoverSelect} flex-1 min-w-[100px]`}
          >
            <option value="">{slots.length ? "Choose a slot…" : "Add a pattern first"}</option>
            {slots.map((s) => (
              <option key={s} value={s}>
                {`{${s}}`}
              </option>
            ))}
          </select>
        ) : action.mode === "formula" ? (
          // The formula has a line of its own below, so all of it can be seen
          <span className="flex-1" />
        ) : (
          <>
            <input
              value={action.value}
              list={listId}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder="Value"
              spellCheck={false}
              className={`${popoverField} flex-1 min-w-[140px]`}
            />
            {action.property && (
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
            // As wide as its longest choice ("as YYYY-MM-DD"), so the chosen one always shows whole
            className={`${popoverSelect} shrink-0`}
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
        {action.mode !== "same" && (
          <label
            className="flex items-center gap-1 text-neutral-400 shrink-0"
            title={
              type === "array"
                ? "Replace the values instead of adding to them. Values you've changed by hand since this rule set them stay, unless Apply Now includes them"
                : "Write over a value that's already there. Values you've changed by hand since this rule set them stay, unless Apply Now includes them"
            }
          >
            <input type="checkbox" checked={!!action.overwrite} onChange={(e) => onChange({ overwrite: e.target.checked })} />
            Overwrite
          </label>
        )}
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
      {action.mode === "same" && (
        <div className="pl-[254px] flex flex-col gap-0.5">
          {(action.also ?? []).map((column, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-neutral-400 shrink-0 w-[28px]">and</span>
              <select
                value={column}
                onChange={(e) => onChange({ also: (action.also ?? []).map((c, j) => (j === i ? e.target.value : c)) })}
                className={`${popoverSelect} flex-1 min-w-0`}
              >
                <option value="">Choose a property…</option>
                <ColumnOptions columns={sameChoices} />
              </select>
              <RemoveButton label="Remove" onClick={() => onChange({ also: (action.also ?? []).filter((_, j) => j !== i) })} />
            </div>
          ))}
          <AddButton onClick={() => onChange({ also: [...(action.also ?? []), ""] })}>And the Same…</AddButton>
          <p className="text-[11px] text-neutral-500">
            Learned from files that have {action.property || "the property"} filled in. Where they disagree, nothing is written: the preview
            says how.
          </p>
        </div>
      )}
      {action.mode === "formula" && (
        <div className="flex items-center gap-1.5 pl-[136px]">
          <input
            value={action.value}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder="upper(slice(name, 3, 7))"
            spellCheck={false}
            aria-label="Formula"
            className={`${popoverField} flex-1 min-w-0 font-mono text-[12px]`}
          />
          <RowToggle label="Formula Help" icon="questionmark.circle" fallback="?" on={helpOpen} onClick={onToggleHelp} />
        </div>
      )}
      {problem && <p className="pl-[136px] text-[11px] text-red-500">{problem}</p>}
      {action.mode === "formula" && helpOpen && help}
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
 * Under a "matches pattern" condition: select part of a matching file's name
 * (or folder, or other column) and name it. The condition's pattern is
 * rewritten around the picked parts, and tried on every file at once.
 */
function ExamplePicker({
  def,
  condition,
  files,
  env,
  columns,
  onChangeDef,
  onClose,
}: {
  def: RuleDefinition;
  condition: FilterRule;
  files: FileRecord[];
  env: RuleEnv;
  columns: FilterColumn[];
  onChangeDef: (patch: Partial<RuleDefinition>) => void;
  onClose: () => void;
}) {
  // The condition's column: the name, a folder (Path Tags), the path, a property…
  const source = condition.column;
  const sourceLabel = columns.find((c) => c.id === source)?.label ?? "Name";
  const isList = columns.find((c) => c.id === source)?.kind === "list";
  // On a list (Path Tags…): which of its items, such as the folder the file is in
  const item = isList ? (condition.item ?? "any") : undefined;
  const isPattern = (c: FilterRule) => c.id === condition.id;
  // The picks kept for this condition (rules saved before they were tied to one: the example on its column)
  const stored =
    def.example &&
    (def.example.column ?? "name") === source &&
    (!def.example.condition || def.example.condition === condition.id) &&
    (def.example.item ?? "any") === (item ?? "any")
      ? def.example
      : undefined;

  /** A file's texts to pick from in the source column: its name (without extension), the chosen folder(s), or the value. */
  const textsOf = (f: FileRecord): string[] => {
    if (source === "name") return [baseName(f.file_path)];
    const v = env.valueOf(f, source);
    if (Array.isArray(v)) return listItems(v.map(valueToText).filter(Boolean), item);
    return [valueToText(v)].filter(Boolean);
  };

  // Examples: every distinct text from the files meeting the conditions other than this column's pattern
  const { allExamples, fromFiles } = useMemo(() => {
    const others = removeItem(def.conditions, condition.id);
    const out: { text: string; label: string }[] = [];
    const seen = new Set<string>();
    let fromFiles = 0;
    for (const f of files) {
      if (evalFilters(others, def.match, (c) => matchesRule(env.valueOf(f, c.column), env.kindOf(c.column), c)) === false) continue;
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
  }, [def.conditions, def.match, files, env, source, item, condition.id]);
  // Typed into the search box: narrows the examples offered
  const [find, setFind] = useState("");
  const examples = useMemo(() => {
    const q = find.trim().toLowerCase();
    return (q ? allExamples.filter((x) => x.label.toLowerCase().includes(q)) : allExamples).slice(0, 500);
  }, [allExamples, find]);

  const exampleName = stored?.name || examples[0]?.text || "";
  const slots = stored?.name === exampleName ? stored.slots : [];
  const [pending, setPending] = useState<{ start: number; end: number; name: string } | null>(null);
  const textRef = useRef<HTMLDivElement>(null);

  /** Rewrites the condition's pattern from the picks; with none left, the pattern they made is cleared. */
  function apply(name: string, next: ExampleSlot[]) {
    const conditions = mapRules(def.conditions, (c) => {
      if (!isPattern(c)) return c;
      if (next.length > 0) return { ...c, value: examplePattern(name, next) };
      return c.value === examplePattern(name, slots) ? { ...c, value: "" } : c;
    });
    onChangeDef({ conditions, example: { name, slots: next, column: source, item, condition: condition.id } });
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
    <div className="ml-2 mt-1 mb-1 pl-3 border-l-2 border-blue-500/40 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <input
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find an example…"
          title="Narrow the examples to ones containing this text"
          className={`${popoverField} w-[140px] shrink-0`}
        />
        <select
          value={exampleName}
          onChange={(e) => onChangeDef({ example: { name: e.target.value, slots: [], column: source, item, condition: condition.id } })}
          title={`${allExamples.length.toLocaleString()} different ${source === "tags" ? "folder names" : `${sourceLabel} values`} from the ${fromFiles.toLocaleString()} files meeting the other conditions${
            examples.length >= 500 ? " (first 500: type to narrow)" : ""
          }`}
          className={`${popoverSelect} flex-1 min-w-[160px]`}
        >
          {!examples.some((x) => x.text === exampleName) && exampleName && <option value={exampleName}>{exampleName}</option>}
          {examples.map((x) => (
            <option key={x.text} value={x.text}>
              {x.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={onClose} className="h-6 px-2 rounded-[6px] text-neutral-400 hover:text-neutral-100 shrink-0">
          Done
        </button>
      </div>
      <p className="text-neutral-500 text-xs">
        {examples.length === 0
          ? find.trim()
            ? `No example contains “${find.trim()}”.`
            : `No file has a ${sourceLabel} to pick from.`
          : `Select the part of the ${source === "tags" ? "folder name" : sourceLabel} you want, then name it.${
              isList && item === "any" ? " Any one that fits counts; choose a particular one in the row to narrow it." : ""
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
        </div>
      )}
    </div>
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
function Preview({ plan, columns, onIncludeHandEdits }: { plan: RulePlan; columns: FilterColumn[]; onIncludeHandEdits: () => void }) {
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
        {counts.edited > 0 && (
          <button
            type="button"
            onClick={onIncludeHandEdits}
            title="Apply Now writes these too, over the values you changed"
            className="ml-2 h-5 px-2 rounded-[5px] text-xs bg-neutral-700/70 text-neutral-100"
          >
            Include Changed by Hand
          </button>
        )}
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
