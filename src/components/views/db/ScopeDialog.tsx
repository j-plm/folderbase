import { useState } from "react";
import Dialog, { DialogButton } from "../../shared/Dialog";
import { popoverSelect } from "../../shared/Popover";
import { SymbolIcon } from "../../../lib/fileIcons";
import { ANY_VALUE, type ScopeCondition } from "../../../lib/scopes";

/**
 * Header menu ▸ Apply Only Where…: the conditions under which a property
 * applies (any of them, or all: the second row's "or"/"and" sets it for every
 * row), e.g. Housing only where Tags has housing. Each row is
 * a property and one of its values (Select and Multi-select), or any value
 * (Component has any value; the only choice for other types).
 */
export default function ScopeDialog({
  property,
  initial,
  initialAll,
  properties,
  valuesFor,
  summary,
  onApply,
  onCancel,
}: {
  property: string;
  initial: ScopeCondition[];
  initialAll: boolean;
  /** Properties a condition can use: any but this one and those that depend on it. */
  properties: string[];
  /** A property's values to choose from, or null when it only offers "any value". */
  valuesFor: (property: string) => string[] | null;
  /** "Applies to 3 files: 1 with a value, 2 to fill in", for the conditions as they stand. */
  summary: (conditions: ScopeCondition[], all: boolean) => string;
  onApply: (conditions: ScopeCondition[], all: boolean) => void;
  onCancel: () => void;
}) {
  const startValue = (property: string) => (valuesFor(property) == null ? ANY_VALUE : "");
  const fresh = (): ScopeCondition => ({ property: properties[0] ?? "", value: startValue(properties[0] ?? "") });
  const [rows, setRows] = useState<ScopeCondition[]>(() => (initial.length > 0 ? initial : [fresh()]));
  const [all, setAll] = useState(initialAll);
  const complete = rows.filter((r) => r.property && r.value);
  const update = (i: number, patch: Partial<ScopeCondition>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Dialog
      title={`Apply “${property}” only where:`}
      message={complete.length > 0 ? summary(complete, all) : "Choose a property and a value."}
      onCancel={onCancel}
      onSubmit={() => {
        if (complete.length > 0) onApply(complete, all && complete.length > 1);
      }}
      footer={
        <>
          <span className="flex-1" />
          <DialogButton onClick={onCancel}>Cancel</DialogButton>
          <DialogButton variant="default" disabled={complete.length === 0}>
            Apply
          </DialogButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {i === 1 ? (
              <select
                value={all ? "and" : "or"}
                onChange={(e) => setAll(e.target.value === "and")}
                aria-label="Conditions combine with"
                className={`${popoverSelect} w-[64px] shrink-0`}
              >
                <option value="or">or</option>
                <option value="and">and</option>
              </select>
            ) : (
              <span className="w-[64px] pr-2 text-right text-neutral-400 shrink-0">{i === 0 ? "" : all ? "and" : "or"}</span>
            )}
            <select
              value={row.property}
              onChange={(e) => update(i, { property: e.target.value, value: startValue(e.target.value) })}
              className={`${popoverSelect} w-[130px]`}
            >
              {properties.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <span className="text-neutral-400 shrink-0">has</span>
            <select
              value={row.value}
              onChange={(e) => update(i, { value: e.target.value })}
              className={`${popoverSelect} flex-1 min-w-0`}
            >
              {valuesFor(row.property) != null && <option value="">Choose…</option>}
              <option value={ANY_VALUE}>Any value</option>
              {/* A condition's value stays listed even if no file holds it any more */}
              {[...new Set([...(row.value && row.value !== ANY_VALUE ? [row.value] : []), ...(valuesFor(row.property) ?? [])])].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <button
              type="button"
              title="Remove condition"
              aria-label="Remove condition"
              disabled={rows.length === 1}
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/60 disabled:opacity-30"
            >
              <SymbolIcon name="minus.circle" size={14} fallback="−" />
            </button>
          </div>
        ))}
        {properties.length > 0 && (
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, fresh()])}
            className="self-start flex items-center gap-1 h-6 px-1.5 ml-[70px] rounded-[6px] text-blue-400 hover:bg-neutral-700/40"
          >
            <SymbolIcon name="plus" size={11} fallback="+" />
            Add Condition
          </button>
        )}
      </div>
    </Dialog>
  );
}
