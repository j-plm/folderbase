import Popover, { popoverField, popoverSelect } from "../../shared/Popover";
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
import type { SortState } from "../../../lib/columns";

export interface FilterColumn {
  id: string;
  label: string;
  kind: ColumnKind;
}

interface Props {
  /** Which panel: the Filter button's rules or the Sort button's keys. */
  section: "filter" | "sort";
  anchor: HTMLElement;
  onClose: () => void;
  columns: FilterColumn[];
  rules: FilterRule[];
  match: FilterMatch;
  sorts: SortState[];
  onRulesChange: (rules: FilterRule[]) => void;
  onMatchChange: (match: FilterMatch) => void;
  onSortsChange: (sorts: SortState[]) => void;
  /** Known values for a list column, offered when filtering it. */
  valuesFor: (columnId: string) => string[];
}

/** The database view's filter rules (Filter button) or sort keys (Sort button). */
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
  valuesFor,
}: Props) {
  const kindOf = (id: string) => columns.find((c) => c.id === id)?.kind ?? "text";
  const first = columns[0];

  function updateRule(id: string, patch: Partial<FilterRule>) {
    onRulesChange(
      rules.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        return patch.column ? fitRule({ ...next, value: "" }, kindOf(patch.column)) : next;
      })
    );
  }

  const unsorted = columns.filter((c) => !sorts.some((s) => s.key === c.id));

  return (
    <Popover anchor={anchor} onClose={onClose} className={section === "filter" ? "w-[440px]" : "w-[340px]"}>
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
            {rules.length === 0 && <p className="text-neutral-500">No filters. Every file is shown.</p>}
            {rules.map((rule) => {
              const kind = kindOf(rule.column);
              return (
                <div key={rule.id} className="flex items-center gap-1.5">
                  <select
                    value={rule.column}
                    onChange={(e) => updateRule(rule.id, { column: e.target.value })}
                    className={`${popoverSelect} w-[120px]`}
                  >
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
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
                  {opNeedsValue(rule.op) ? (
                    <RuleValue kind={kind} value={rule.value} values={valuesFor(rule.column)} onChange={(value) => updateRule(rule.id, { value })} />
                  ) : (
                    <span className="flex-1" />
                  )}
                  <RemoveButton label="Remove filter" onClick={() => onRulesChange(rules.filter((r) => r.id !== rule.id))} />
                </div>
              );
            })}
            {first && (
              <AddButton onClick={() => onRulesChange([...rules, newRule(first.id, first.kind)])}>Add Filter</AddButton>
            )}
          </>
        )}

        {section === "sort" && (
          <>
            <p className="font-semibold">Sort</p>
            {sorts.length === 0 && <p className="text-neutral-500">Unsorted.</p>}
            {sorts.map((sort, i) => (
              <div key={sort.key} className="flex items-center gap-1.5">
                <span className="w-[52px] text-right text-neutral-400 shrink-0">{i === 0 ? "Sort by" : "then by"}</span>
                <select
                  value={sort.key}
                  onChange={(e) => onSortsChange(sorts.map((s, j) => (j === i ? { ...s, key: e.target.value } : s)))}
                  className={`${popoverSelect} flex-1 min-w-0`}
                >
                  {columns
                    .filter((c) => c.id === sort.key || !sorts.some((s) => s.key === c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                </select>
                <select
                  value={sort.direction}
                  onChange={(e) =>
                    onSortsChange(sorts.map((s, j) => (j === i ? { ...s, direction: e.target.value as SortState["direction"] } : s)))
                  }
                  className={`${popoverSelect} w-[110px]`}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <RemoveButton label="Remove sort" onClick={() => onSortsChange(sorts.filter((_, j) => j !== i))} />
              </div>
            ))}
            {unsorted.length > 0 && (
              <AddButton onClick={() => onSortsChange([...sorts, { key: unsorted[0].id, direction: "asc" }])}>
                {sorts.length === 0 ? "Add Sort" : "Add Sort Level"}
              </AddButton>
            )}
          </>
        )}
      </div>
    </Popover>
  );
}

function RuleValue({
  kind,
  value,
  values,
  onChange,
}: {
  kind: ColumnKind;
  value: string;
  values: string[];
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
      onChange={(e) => onChange(e.target.value)}
      className={cls}
    />
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
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

function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start flex items-center gap-1 h-6 px-1.5 -ml-1.5 rounded-[6px] text-blue-400 hover:bg-neutral-700/40"
    >
      <SymbolIcon name="plus" size={11} fallback="+" />
      {children}
    </button>
  );
}
