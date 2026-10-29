import Popover, { popoverField, popoverSelect } from "../../shared/Popover";
import ColumnOptions from "../../shared/ColumnOptions";
import { useRef, useState } from "react";
import type React from "react";
import { SymbolIcon } from "../../../lib/fileIcons";
import {
  FILTER_OPS,
  fitRule,
  isFilterGroup,
  newRule,
  opNeedsValue,
  type ColumnKind,
  type FilterGroup,
  type FilterItem,
  type FilterMatch,
  type FilterRule,
} from "../../../lib/dbTable";
import {
  MAX_GROUP_DEPTH,
  addItem,
  canMoveInto,
  duplicateItem,
  findItem,
  locate,
  mapRules,
  moveItem,
  newGroup,
  otherMatch,
  removeItem,
  setGroupMatch,
  ungroup,
  wrapInGroup,
} from "../../../lib/filterTree";
import { showContextMenu, type MenuEntry } from "../../../lib/nativeMenu";
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
  /** Filters and groups of them, joined by `match` (each group by its own). */
  rules: FilterItem[];
  match: FilterMatch;
  sorts: SortState[];
  onRulesChange: (rules: FilterItem[]) => void;
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
    <Popover
      anchor={anchor}
      onClose={onClose}
      // Groups indent their rows: wider while there are any
      className={section === "filter" ? (rules.some(isFilterGroup) ? "w-[640px]" : "w-[540px]") : section === "group" ? "w-[380px]" : "w-[360px]"}
    >
      <div className="flex flex-col gap-2 p-3">
        {section === "filter" && (
          <>
            <p className="font-semibold">Filter</p>
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
            <ConditionTree
              columns={columns}
              items={rules}
              match={match}
              onChange={onRulesChange}
              onMatchChange={onMatchChange}
              valuesFor={valuesFor}
              noun="Filter"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {first && <AddButton onClick={() => onRulesChange([...rules, newRule(first.id, first.kind)])}>Add Filter</AddButton>}
              {first && <AddButton onClick={() => onRulesChange([...rules, newFilterGroup(match, first)])}>Add Filter Group</AddButton>}
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

/** A drop place while dragging a filter: a group (null: the top of the list) and a place in it, and where the line goes. */
interface DropTarget {
  group: string | null;
  index: number;
  top: number;
  left: number;
  width: number;
}

/**
 * Filters as rows (column, condition, value, remove), and groups of them in
 * boxes, each list joined by its own And/Or: the Filter panel's, and a rule's
 * When in the Rules panel. The first row of a list reads "Where", the second
 * picks And or Or for the whole list and the rest repeat it. Rows drag by
 * their handle, into and out of groups; right-click for Duplicate, Put in
 * Group, Ungroup and Remove.
 */
export function ConditionTree({
  columns,
  items,
  match,
  onChange,
  onMatchChange,
  valuesFor,
  noun,
  rowAction,
  below,
}: {
  columns: FilterColumn[];
  items: FilterItem[];
  /** How the top of the list joins (each group has its own). */
  match: FilterMatch;
  onChange: (items: FilterItem[]) => void;
  onMatchChange: (match: FilterMatch) => void;
  valuesFor: (columnId: string) => string[];
  /** What a row is called in its buttons and menus: "Filter", "Condition". */
  noun: string;
  /** A control at the end of a row, before its remove button. */
  rowAction?: (rule: FilterRule) => React.ReactNode;
  /** Shown under a row, attached to it. */
  below?: (rule: FilterRule) => React.ReactNode;
}) {
  const kindOf = (id: string) => columns.find((c) => c.id === id)?.kind ?? "text";
  const first = columns[0];
  const lower = noun.toLowerCase();
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; target: DropTarget | null } | null>(null);
  const draggable = items.length > 1 || items.some(isFilterGroup);

  function changeRule(id: string, patch: Partial<FilterRule>) {
    const rule = findItem(items, id);
    if (!rule || isFilterGroup(rule)) return;
    const next = { ...rule, ...patch };
    const fitted = patch.column ? fitRule({ ...next, value: "" }, kindOf(patch.column)) : next;
    onChange(mapRules(items, (r) => (r.id === id ? fitted : r)));
  }

  /** The drop place under the pointer: before or after the row it's over, or the end of a group over its footer. */
  function targetAt(dragId: string, x: number, y: number): DropTarget | null {
    const list = listRef.current;
    if (!list) return null;
    const box = list.getBoundingClientRect();
    const dragged = list.querySelector(`[data-filter-item="${dragId}"]`);
    const spots = [...list.querySelectorAll<HTMLElement>("[data-filter-item], [data-filter-append]")]
      .filter((el) => !dragged?.contains(el))
      .map((el) => ({ el, r: el.getBoundingClientRect(), depth: Number(el.dataset.depth) }))
      // Rows sit 8px apart: half the gap belongs to each
      .filter(({ r }) => y >= r.top - 4 && y <= r.bottom + 4);
    // The innermost row under the pointer; failing that, the outermost on its line
    const inside = spots.filter(({ r }) => x >= r.left && x <= r.right);
    const hit = inside.length > 0 ? inside.reduce((a, b) => (b.depth > a.depth ? b : a)) : spots.reduce<(typeof spots)[number] | null>((a, b) => (!a || b.depth < a.depth ? b : a), null);
    let target: DropTarget;
    if (!hit) {
      // Above or below everything: the start or end of the list
      const end = y > box.top + box.height / 2;
      target = { group: null, index: end ? items.length : 0, top: end ? box.height + 3 : -5, left: 0, width: box.width };
    } else if (hit.el.dataset.filterAppend != null) {
      const group = findItem(items, hit.el.dataset.filterAppend);
      if (!group || !isFilterGroup(group)) return null;
      target = { group: group.id, index: group.items.length, top: hit.r.top - box.top - 5, left: hit.r.left - box.left, width: hit.r.width };
    } else {
      const after = y > hit.r.top + hit.r.height / 2;
      target = {
        group: hit.el.dataset.group || null,
        index: Number(hit.el.dataset.index) + (after ? 1 : 0),
        top: (after ? hit.r.bottom : hit.r.top) - box.top + (after ? 3 : -5),
        left: hit.r.left - box.left,
        width: hit.r.width,
      };
    }
    if (!canMoveInto(items, dragId, target.group)) return null;
    // Where it already is: nothing to show
    const from = locate(items, dragId);
    if (from && (from.parent?.id ?? null) === target.group && (target.index === from.index || target.index === from.index + 1)) return null;
    return target;
  }

  function startDrag(e: React.MouseEvent<HTMLElement>, id: string) {
    if (e.button !== 0 || !draggable) return;
    e.preventDefault();
    let target: DropTarget | null = null;
    setDrag({ id, target });
    const onMove = (ev: MouseEvent) => {
      target = targetAt(id, ev.clientX, ev.clientY);
      setDrag({ id, target });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDrag(null);
      if (target) onChange(moveItem(items, id, target.group, target.index));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function showMenu(e: React.MouseEvent, item: FilterItem) {
    // Fields keep their own menu (Cut, Copy, Paste)
    if ((e.target as Element).closest("input, select, textarea")) return;
    e.preventDefault();
    e.stopPropagation();
    const at = locate(items, item.id);
    const parent = at?.parent ?? null;
    const entries: MenuEntry[] = [{ type: "item", text: "Duplicate", action: () => onChange(duplicateItem(items, item.id)) }];
    if (isFilterGroup(item)) {
      entries.push({ type: "item", text: "Ungroup", action: () => onChange(ungroup(items, item.id)) });
    } else {
      entries.push({
        type: "item",
        text: "Put in Group",
        enabled: wrapInGroup(items, item.id, match) !== items,
        action: () => onChange(wrapInGroup(items, item.id, match)),
      });
    }
    if (parent && at) {
      // Out to the list the group sits in, just after the group
      const outer = locate(items, parent.id);
      entries.push({
        type: "item",
        text: "Move Out of Group",
        action: () => outer && onChange(moveItem(items, item.id, outer.parent?.id ?? null, outer.index + 1)),
      });
    }
    entries.push(
      { type: "separator" },
      { type: "item", text: isFilterGroup(item) ? "Remove Group" : `Remove ${noun}`, action: () => onChange(removeItem(items, item.id)) }
    );
    void showContextMenu(entries);
  }

  /** The words before a row: "Where", then And/Or (chosen on the second row, for the whole list). */
  function lead(index: number, group: FilterGroup | null) {
    const joined = group?.match ?? match;
    if (index === 0) return <span className="w-[58px] shrink-0 pl-[7px] leading-[22px] text-neutral-400">Where</span>;
    if (index === 1) {
      return (
        <select
          value={joined}
          onChange={(e) => {
            const m = e.target.value as FilterMatch;
            if (group) onChange(setGroupMatch(items, group.id, m));
            else onMatchChange(m);
          }}
          title={`Whether all of these must hold (And) or any one of them (Or)`}
          className={`${popoverSelect} w-[58px] shrink-0`}
        >
          <option value="all">And</option>
          <option value="any">Or</option>
        </select>
      );
    }
    return <span className="w-[58px] shrink-0 pl-[7px] leading-[22px] text-neutral-500">{joined === "all" ? "And" : "Or"}</span>;
  }

  function handle(id: string) {
    return (
      <span
        onMouseDown={(e) => startDrag(e, id)}
        title={draggable ? "Drag to move, into or out of a group" : undefined}
        aria-label="Drag to move"
        className={`w-4 h-[22px] shrink-0 flex items-center justify-center text-neutral-500 ${
          draggable ? "cursor-grab active:cursor-grabbing hover:text-neutral-300" : "opacity-40"
        }`}
      >
        <SymbolIcon name="line.3.horizontal" size={11} fallback="≡" />
      </span>
    );
  }

  function ruleRow(rule: FilterRule) {
    const kind = kindOf(rule.column);
    const problem = rule.op === "matches" && rule.value.trim() ? patternProblem(rule.value.trim()) : null;
    return (
      // Narrow (a slim Rules panel, a deep group): the value moves to a line of its own rather than being squeezed
      <div className="@container flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <select
            value={rule.column}
            onChange={(e) => changeRule(rule.id, { column: e.target.value })}
            className={`${popoverSelect} w-[120px] min-w-0 @max-[30rem]:grow`}
          >
            <ColumnOptions columns={columns} />
          </select>
          <select
            value={rule.op}
            onChange={(e) => changeRule(rule.id, { op: e.target.value as FilterRule["op"] })}
            className={`${popoverSelect} w-[118px] min-w-0 @max-[30rem]:grow`}
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
              onChange={(e) => changeRule(rule.id, { item: e.target.value === "any" ? undefined : e.target.value })}
              title="Which of them the pattern is tried on"
              className={`${popoverSelect} w-[132px] min-w-0 @max-[30rem]:grow`}
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
              onChange={(value) => changeRule(rule.id, { value })}
            />
          ) : (
            <span className="flex-1" />
          )}
          {rowAction?.(rule)}
          <RemoveButton label={`Remove ${lower}`} onClick={() => onChange(removeItem(items, rule.id))} />
        </div>
        {problem && <p className="pl-[126px] @max-[30rem]:pl-0 text-[11px] text-red-500">{problem}</p>}
        {below?.(rule)}
      </div>
    );
  }

  function list(entries: FilterItem[], group: FilterGroup | null, depth: number): React.ReactNode {
    return entries.map((item, i) => (
      <div
        key={item.id}
        data-filter-item={item.id}
        data-group={group?.id ?? ""}
        data-index={i}
        data-depth={depth}
        onContextMenu={(e) => showMenu(e, item)}
        className={`flex items-start gap-1.5 ${drag?.id === item.id ? "opacity-50" : ""}`}
      >
        {handle(item.id)}
        {lead(i, group)}
        {isFilterGroup(item) ? (
          <div className="flex-1 min-w-0 flex flex-col gap-2 p-2 rounded-[8px] border border-neutral-700/60 bg-neutral-700/20">
            {list(item.items, item, depth + 1)}
            <div data-filter-append={item.id} data-depth={depth + 1} className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
              {first && <AddButton onClick={() => onChange(addItem(items, item.id, newRule(first.id, first.kind)))}>{`Add ${noun}`}</AddButton>}
              {first && depth + 1 < MAX_GROUP_DEPTH && (
                <AddButton onClick={() => onChange(addItem(items, item.id, newGroup(otherMatch(item.match), [newRule(first.id, first.kind)])))}>
                  Add Group
                </AddButton>
              )}
              <span className="flex-1" />
              <GroupMenuButton onClick={(e) => showMenu(e, item)} />
            </div>
          </div>
        ) : (
          ruleRow(item)
        )}
      </div>
    ));
  }

  return (
    <div ref={listRef} className="relative flex flex-col gap-2">
      {list(items, null, 0)}
      {drag?.target && (
        <span
          aria-hidden
          className="absolute h-[2px] rounded-full bg-blue-500 pointer-events-none"
          style={{ top: drag.target.top, left: drag.target.left, width: drag.target.width }}
        />
      )}
    </div>
  );
}

/** A group's "…": the same menu as right-clicking it. */
function GroupMenuButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      title="Group Options"
      aria-label="Group Options"
      onClick={onClick}
      className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/60"
    >
      <SymbolIcon name="ellipsis.circle" size={14} fallback="…" />
    </button>
  );
}

/** A new group at the top of a list: joined the other way to the list, with one empty row to start. */
export function newFilterGroup(match: FilterMatch, column: FilterColumn): FilterGroup {
  return newGroup(otherMatch(match), [newRule(column.id, column.kind)]);
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
  // At least wide enough to read: past that, it wraps below the column and condition
  const cls = `${popoverField} flex-1 min-w-[140px]`;
  if (kind === "list") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${popoverSelect} flex-1 min-w-[140px]`}>
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
