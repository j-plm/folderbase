import Popover, { popoverField, popoverSelect } from "../../shared/Popover";
import ColumnOptions from "../../shared/ColumnOptions";
import { useRef, useState } from "react";
import type React from "react";
import { SymbolIcon } from "../../../lib/fileIcons";
import {
  FILTER_OPS,
  fitRule,
  newRule,
  opNeedsValue,
  type ColumnKind,
  type FilterMatch,
  type FilterRule,
} from "../../../lib/dbTable";
import { dropIndexAt, moveColumnId, type SortState } from "../../../lib/columns";
import type { PlaceFilter } from "../../../lib/folderTree";
import { compilePattern, isPatternError } from "../../../lib/patterns";

/** What's wrong with a "matches pattern" value, or null. */
function patternProblem(pattern: string): string | null {
  const c = compilePattern(pattern);
  return isPatternError(c) ? c.error : null;
}

export interface FilterColumn {
  id: string;
  label: string;
  kind: ColumnKind;
}

interface Props {
  /** Which panel: the Filter button's rules, the Sort button's keys or the Group button's levels. */
  section: "filter" | "sort" | "group";
  anchor: HTMLElement;
  onClose: () => void;
  columns: FilterColumn[];
  rules: FilterRule[];
  match: FilterMatch;
  sorts: SortState[];
  onRulesChange: (rules: FilterRule[]) => void;
  onMatchChange: (match: FilterMatch) => void;
  onSortsChange: (sorts: SortState[]) => void;
  /** Grouping levels, outermost first. */
  groups: SortState[];
  onGroupsChange: (groups: SortState[]) => void;
  /** The order a newly added grouping level starts in. */
  defaultGroupDirection: (columnId: string) => SortState["direction"];
  /** Folds every group shut (true) or opens them all. */
  onCollapseAll: (collapse: boolean) => void;
  /** Whether a grouping level's groups are all collapsed, all open, or some of each. */
  groupLevelState: (depth: number) => "collapsed" | "expanded" | "mixed";
  /** Folds every group at one level shut (true) or opens them. */
  onCollapseLevel: (depth: number, collapse: boolean) => void;
  /** Known values for a list column, offered when filtering it. */
  valuesFor: (columnId: string) => string[];
  /** Opens the Rules panel with a new rule made from these filters. */
  onMakeRule?: () => void;
  /**
   * The folder you're in: a row per folder on the way, narrowing the view
   * without being one of its filters. Changing a row's folder moves there;
   * removing it goes up out of that folder.
   */
  folder?: { filters: PlaceFilter[]; onGo: (path: string[]) => void };
  /**
   * The view's folders below where you are, which group the table while it has
   * no grouping of its own (when `on`).
   */
  folderGrouping?: {
    name: string | null;
    levels: string[];
    on: boolean;
    onToggle: (on: boolean) => void;
    onEditHierarchy: () => void;
  };
}

/** The database view's filter rules (Filter button), sort keys (Sort button) or grouping levels (Group button). */
export default function FilterSortPopover({
  section,
  anchor,
  onClose,
  columns,
  rules,
  match,
  sorts,
  onRulesChange,
  onMatchChange,
  onSortsChange,
  groups,
  onGroupsChange,
  defaultGroupDirection,
  onCollapseAll,
  groupLevelState,
  onCollapseLevel,
  valuesFor,
  onMakeRule,
  folder,
  folderGrouping,
}: Props) {
  const first = columns[0];

  const unsorted = columns.filter((c) => !sorts.some((s) => s.key === c.id));
  const ungrouped = columns.filter((c) => !groups.some((g) => g.key === c.id));

  return (
    <Popover anchor={anchor} onClose={onClose} className={section === "filter" ? "w-[440px]" : section === "group" ? "w-[380px]" : "w-[360px]"}>
      <div className="flex flex-col gap-2 p-3">
        {section === "filter" && (
          <>
            <div className="flex items-center gap-2">
              <p className="font-semibold flex-1">Filter</p>
              {rules.length > 1 && (
                <label className="flex items-center gap-1.5 text-neutral-400">
                  Match
                  <select
                    value={match}
                    onChange={(e) => onMatchChange(e.target.value as FilterMatch)}
                    className={popoverSelect}
                  >
                    <option value="all">all rules</option>
                    <option value="any">any rule</option>
                  </select>
                </label>
              )}
            </div>
            {folder && folder.filters.length > 0 && (
              <div className="flex flex-col gap-1.5 pb-2 border-b border-neutral-700/60">
                <div className="flex items-baseline gap-2">
                  <p className="text-neutral-400 flex-1">In folder</p>
                  <button
                    type="button"
                    onClick={() => folder.onGo([])}
                    className="h-6 px-1.5 rounded-[6px] text-blue-400 hover:bg-neutral-700/40"
                  >
                    Exit Folder
                  </button>
                </div>
                {folder.filters.map((f, i) => (
                  <div key={f.path.join("/")} className="flex items-center gap-1.5">
                    <span className={`${popoverField} w-[120px] flex items-center text-neutral-400 truncate`}>{f.column}</span>
                    <span className="w-[118px] text-neutral-400">is</span>
                    <select
                      value={f.value}
                      onChange={(e) => folder.onGo([...f.path.slice(0, -1), e.target.value])}
                      className={`${popoverSelect} flex-1 min-w-0`}
                    >
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <RemoveButton
                      label={i === 0 ? "Exit folder" : "Go up out of this folder"}
                      onClick={() => folder.onGo(f.path.slice(0, -1))}
                    />
                  </div>
                ))}
                <p className="text-[11px] text-neutral-500">Where you are in the view's folders. It isn't saved with the view.</p>
              </div>
            )}
            {rules.length === 0 && (
              <p className="text-neutral-500">
                {folder?.filters.length ? "No filters of the view's own." : "No filters. Every file is shown."}
              </p>
            )}
            <ConditionRows columns={columns} rules={rules} onChange={onRulesChange} valuesFor={valuesFor} removeLabel="Remove filter" />
            <div className="flex items-center">
              {first && (
                <AddButton onClick={() => onRulesChange([...rules, newRule(first.id, first.kind)])}>Add Filter</AddButton>
              )}
              {onMakeRule && (
                <button
                  type="button"
                  onClick={onMakeRule}
                  title="A rule that sets values on the files these filters show"
                  className="ml-auto h-6 px-1.5 rounded-[6px] text-blue-400 hover:bg-neutral-700/40"
                >
                  Make Rule from Filter…
                </button>
              )}
            </div>
          </>
        )}

        {section === "sort" && (
          <>
            <p className="font-semibold">Sort</p>
            {sorts.length === 0 && <p className="text-neutral-500">Unsorted.</p>}
            <LevelList
              levels={sorts}
              columns={columns}
              lead={(i) => (i === 0 ? "Sort by" : "then by")}
              leadWidth={52}
              removeLabel="Remove sort"
              onKeyChange={(key) => ({ key, direction: "asc" })}
              onChange={onSortsChange}
            />
            {unsorted.length > 0 && (
              <AddButton onClick={() => onSortsChange([...sorts, { key: unsorted[0].id, direction: "asc" }])}>
                {sorts.length === 0 ? "Add Sort" : "Add Sort Level"}
              </AddButton>
            )}
          </>
        )}

        {section === "group" && (
          <>
            <p className="font-semibold">Group</p>
            {folderGrouping && (
              // One line: the switch, then the view's folder levels, which open its Hierarchy
              <div
                className={`flex items-center gap-1.5 min-w-0 pb-2 border-b border-neutral-700/60 ${
                  folderGrouping.on && groups.length > 0 ? "text-neutral-500" : ""
                }`}
                title={
                  groups.length > 0
                    ? "The groups below take its place while there are any."
                    : `Groups by the folders ${folderGrouping.name ? `below “${folderGrouping.name}”` : "of the view"}.`
                }
              >
                <label className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="checkbox"
                    checked={folderGrouping.on}
                    onChange={(e) => folderGrouping.onToggle(e.target.checked)}
                  />
                  Group by Hierarchy
                </label>
                <button
                  type="button"
                  onClick={folderGrouping.onEditHierarchy}
                  title="Edit Hierarchy…"
                  className="min-w-0 truncate text-blue-400 hover:underline"
                >
                  {folderGrouping.levels.join(" › ")}
                </button>
              </div>
            )}
            {groups.length === 0 && !folderGrouping?.on && <p className="text-neutral-500">Not grouped.</p>}
            <LevelList
              levels={groups}
              columns={columns}
              lead={(i) => (i === 0 ? "Group by" : "then by")}
              leadWidth={62}
              removeLabel="Remove grouping level"
              onKeyChange={(key) => ({ key, direction: defaultGroupDirection(key) })}
              onChange={onGroupsChange}
              disclosure={{ stateAt: groupLevelState, onToggle: onCollapseLevel }}
            />
            <div className="flex items-center">
              {ungrouped.length > 0 && (
                <AddButton
                  onClick={() =>
                    onGroupsChange([...groups, { key: ungrouped[0].id, direction: defaultGroupDirection(ungrouped[0].id) }])
                  }
                >
                  {groups.length === 0 ? "Add Grouping" : "Add Grouping Level"}
                </AddButton>
              )}
              {groups.length > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  <TextButton onClick={() => onCollapseAll(true)}>Collapse All</TextButton>
                  <TextButton onClick={() => onCollapseAll(false)}>Expand All</TextButton>
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}

/** Which item of a list a pattern is tried on: Path Tags are folders, top first. */
export function itemChoices(columnId: string): [string, string][] {
  return columnId === "tags"
    ? [
        ["any", "any folder"],
        ["last", "the folder it's in"],
        ["first", "the top folder"],
        ["n:2", "the 2nd folder"],
        ["n:3", "the 3rd folder"],
      ]
    : [
        ["any", "any item"],
        ["first", "the first item"],
        ["n:2", "the 2nd item"],
        ["last", "the last item"],
      ];
}

/**
 * Filter rules as rows (column, condition, value, remove): the Filter panel's,
 * and a rule's When section in the Rules panel.
 */
export function ConditionRows({
  columns,
  rules,
  onChange,
  valuesFor,
  removeLabel,
  rowAction,
  below,
}: {
  columns: FilterColumn[];
  rules: FilterRule[];
  onChange: (rules: FilterRule[]) => void;
  valuesFor: (columnId: string) => string[];
  removeLabel: string;
  /** A control at the end of a row, before its remove button. */
  rowAction?: (rule: FilterRule) => React.ReactNode;
  /** Shown under a row, attached to it. */
  below?: (rule: FilterRule) => React.ReactNode;
}) {
  const kindOf = (id: string) => columns.find((c) => c.id === id)?.kind ?? "text";
  function updateRule(id: string, patch: Partial<FilterRule>) {
    onChange(
      rules.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        return patch.column ? fitRule({ ...next, value: "" }, kindOf(patch.column)) : next;
      })
    );
  }
  return (
    <>
      {rules.map((rule) => {
        const kind = kindOf(rule.column);
        const problem = rule.op === "matches" && rule.value.trim() ? patternProblem(rule.value.trim()) : null;
        return (
          <div key={rule.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <select
                value={rule.column}
                onChange={(e) => updateRule(rule.id, { column: e.target.value })}
                className={`${popoverSelect} w-[120px]`}
              >
                <ColumnOptions columns={columns} />
              </select>
              <select
                value={rule.op}
                onChange={(e) => updateRule(rule.id, { op: e.target.value as FilterRule["op"] })}
                className={`${popoverSelect} w-[118px]`}
              >
                {FILTER_OPS[kind].map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
              {/* A pattern on a list can be tried on one item only (a particular folder) */}
              {rule.op === "matches" && kind === "list" && (
                <select
                  value={rule.item ?? "any"}
                  onChange={(e) => updateRule(rule.id, { item: e.target.value === "any" ? undefined : e.target.value })}
                  title="Which of them the pattern is tried on"
                  className={`${popoverSelect} w-[132px]`}
                >
                  {itemChoices(rule.column).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
              {opNeedsValue(rule.op) ? (
                <RuleValue
                  // A pattern is always typed, whatever the column (a list's dropdown or a date picker can't hold one)
                  kind={rule.op === "matches" ? "text" : kind}
                  value={rule.value}
                  values={valuesFor(rule.column)}
                  placeholder={rule.op === "matches" ? "{Date:6}_{Person}" : undefined}
                  onChange={(value) => updateRule(rule.id, { value })}
                />
              ) : (
                <span className="flex-1" />
              )}
              {rowAction?.(rule)}
              <RemoveButton label={removeLabel} onClick={() => onChange(rules.filter((r) => r.id !== rule.id))} />
            </div>
            {problem && <p className="pl-[246px] text-[11px] text-red-500">{problem}</p>}
            {below?.(rule)}
          </div>
        );
      })}
    </>
  );
}

function RuleValue({
  kind,
  value,
  values,
  placeholder,
  onChange,
}: {
  kind: ColumnKind;
  value: string;
  values: string[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const cls = `${popoverField} flex-1 min-w-0`;
  if (kind === "list") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${popoverSelect} flex-1 min-w-0`}>
        <option value="">Choose…</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (kind === "date") return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={cls} />;
  return (
    <input
      autoFocus={value === ""}
      inputMode={kind === "number" ? "decimal" : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cls}
    />
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/60"
    >
      <SymbolIcon name="minus.circle" size={14} fallback="−" />
    </button>
  );
}

export function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={children}
      // One line, cut short with "…" when the space is narrow (a wrapped label overran the fixed height)
      className="self-start max-w-full min-w-0 flex items-center gap-1 h-6 px-1.5 -ml-1.5 rounded-[6px] text-left whitespace-nowrap text-blue-400 hover:bg-neutral-700/40"
    >
      <SymbolIcon name="plus" size={11} fallback="+" className="shrink-0" />
      <span className="truncate">{children}</span>
    </button>
  );
}

function TextButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className="h-6 px-1.5 rounded-[6px] text-blue-400 hover:bg-neutral-700/40">
      {children}
    </button>
  );
}

/**
 * Sort keys or grouping levels, in order: each row picks a column and a
 * direction, and drags by its handle to change the order.
 */
function LevelList({
  levels,
  columns,
  lead,
  leadWidth,
  removeLabel,
  onKeyChange,
  onChange,
  disclosure,
}: {
  levels: SortState[];
  columns: FilterColumn[];
  /** The words before a row's column ("Sort by", "then by"). */
  lead: (index: number) => string;
  leadWidth: number;
  removeLabel: string;
  /** A level once its column is changed to `key`. */
  onKeyChange: (key: string) => SortState;
  onChange: (levels: SortState[]) => void;
  /** Grouping only: a per-level arrow that collapses or expands that level's groups. */
  disclosure?: {
    stateAt: (index: number) => "collapsed" | "expanded" | "mixed";
    onToggle: (index: number, collapse: boolean) => void;
  };
}) {
  const listRef = useRef<HTMLDivElement>(null);
  /** The level being dragged, and the slot (0..levels.length) it would drop into. */
  const [drag, setDrag] = useState<{ key: string; target: number } | null>(null);

  function rowHeights(): number[] {
    const list = listRef.current;
    return list ? [...list.children].filter((el) => el instanceof HTMLElement && el.dataset.level).map((el) => (el as HTMLElement).offsetHeight + 8) : [];
  }

  function startDrag(e: React.MouseEvent<HTMLElement>, key: string) {
    if (e.button !== 0 || levels.length < 2) return;
    e.preventDefault();
    const heights = rowHeights();
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    const targetAt = (clientY: number) => dropIndexAt(heights, clientY - top, 0);
    setDrag({ key, target: levels.findIndex((l) => l.key === key) });
    let target = levels.findIndex((l) => l.key === key);
    const onMove = (ev: MouseEvent) => {
      target = targetAt(ev.clientY);
      setDrag({ key, target });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDrag(null);
      const ids = levels.map((l) => l.key);
      const order = moveColumnId(ids, key, target);
      if (order.some((id, i) => id !== ids[i])) onChange(order.map((id) => levels.find((l) => l.key === id)!));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // The insertion line: above the row at the target slot, or below the last row
  const from = drag ? levels.findIndex((l) => l.key === drag.key) : -1;
  const showLine = drag != null && drag.target !== from && drag.target !== from + 1;

  return (
    <div ref={listRef} className="relative flex flex-col gap-2">
      {levels.map((level, i) => (
        <div
          key={level.key}
          data-level={level.key}
          className={`relative flex items-center gap-1.5 ${drag?.key === level.key ? "opacity-50" : ""}`}
        >
          {showLine && drag!.target === i && <DropLine edge="top" />}
          {showLine && i === levels.length - 1 && drag!.target === levels.length && <DropLine edge="bottom" />}
          <span
            onMouseDown={(e) => startDrag(e, level.key)}
            title={levels.length > 1 ? "Drag to reorder" : undefined}
            aria-label="Drag to reorder"
            className={`w-4 h-5 shrink-0 flex items-center justify-center text-neutral-500 ${
              levels.length > 1 ? "cursor-grab active:cursor-grabbing hover:text-neutral-300" : "opacity-40"
            }`}
          >
            <SymbolIcon name="line.3.horizontal" size={11} fallback="≡" />
          </span>
          <span className="text-right text-neutral-400 shrink-0" style={{ width: leadWidth }}>
            {lead(i)}
          </span>
          <select
            value={level.key}
            onChange={(e) => onChange(levels.map((l, j) => (j === i ? onKeyChange(e.target.value) : l)))}
            className={`${popoverSelect} flex-1 min-w-0`}
          >
            <ColumnOptions columns={columns.filter((c) => c.id === level.key || !levels.some((l) => l.key === c.id))} />
          </select>
          <select
            value={level.direction}
            onChange={(e) =>
              onChange(levels.map((l, j) => (j === i ? { ...l, direction: e.target.value as SortState["direction"] } : l)))
            }
            className={`${popoverSelect} w-[110px]`}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          {disclosure && (
            <LevelDisclosure
              state={disclosure.stateAt(i)}
              name={columns.find((c) => c.id === level.key)?.label ?? ""}
              // Some open, or all open: collapse; all shut: expand
              onToggle={(collapse) => disclosure.onToggle(i, collapse)}
            />
          )}
          <RemoveButton label={removeLabel} onClick={() => onChange(levels.filter((_, j) => j !== i))} />
        </div>
      ))}
    </div>
  );
}

function DropLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <span
      aria-hidden
      className={`absolute left-0 right-0 h-[2px] rounded-full bg-blue-500 pointer-events-none ${
        edge === "top" ? "-top-[5px]" : "-bottom-[5px]"
      }`}
    />
  );
}

/**
 * A grouping level's arrow, as on the table's group headings: pointing down
 * while its groups are open, right once they are all collapsed. Clicking
 * collapses the level, or expands it when it's already all collapsed.
 */
function LevelDisclosure({
  state,
  name,
  onToggle,
}: {
  state: "collapsed" | "expanded" | "mixed";
  name: string;
  onToggle: (collapse: boolean) => void;
}) {
  const collapse = state !== "collapsed";
  const label = `${collapse ? "Collapse" : "Expand"} ${name} Groups`;
  return (
    <button
      type="button"
      title={state === "mixed" ? `${label} (some are collapsed)` : label}
      aria-label={label}
      aria-expanded={state !== "collapsed"}
      onClick={() => onToggle(collapse)}
      className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/60"
    >
      <SymbolIcon
        name="chevron.right"
        size={10}
        fallback="›"
        className={`transition-transform duration-150 ${state === "collapsed" ? "" : state === "mixed" ? "rotate-45" : "rotate-90"}`}
      />
    </button>
  );
}
