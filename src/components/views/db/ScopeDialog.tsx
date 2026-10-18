import { useState } from "react";
import Dialog, { DialogButton } from "../../shared/Dialog";
import { popoverSelect } from "../../shared/Popover";
import { SymbolIcon } from "../../../lib/fileIcons";
import type { ScopeCondition } from "../../../lib/scopes";

/**
 * Header menu ▸ Apply Only Where…: the conditions under which a property
 * applies (any of them), e.g. Housing only where Tags has housing. Each row is
 * a Select or Multi-select property and one of its values.
 */
export default function ScopeDialog({
  property,
  initial,
  properties,
  valuesFor,
  summary,
  onApply,
  onCancel,
}: {
  property: string;
  initial: ScopeCondition[];
  /** Properties a condition can use: lists, without this one or any that depend on it. */
  properties: string[];
  valuesFor: (property: string) => string[];
  /** "Applies to 3 files: 1 with a value, 2 to fill in", for the conditions as they stand. */
  summary: (conditions: ScopeCondition[]) => string;
  onApply: (conditions: ScopeCondition[]) => void;
  onCancel: () => void;
}) {
  const fresh = (): ScopeCondition => ({ property: properties[0] ?? "", value: "" });
  const [rows, setRows] = useState<ScopeCondition[]>(() => (initial.length > 0 ? initial : [fresh()]));
  const complete = rows.filter((r) => r.property && r.value);
  const update = (i: number, patch: Partial<ScopeCondition>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Dialog
      title={`Apply “${property}” only where:`}
      message={complete.length > 0 ? summary(complete) : "Choose a property and a value."}
      onCancel={onCancel}
      onSubmit={() => {
        if (complete.length > 0) onApply(complete);
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
            <span className="w-[22px] text-right text-neutral-400 shrink-0">{i === 0 ? "" : "or"}</span>
            <select
              value={row.property}
              onChange={(e) => update(i, { property: e.target.value, value: "" })}
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
              <option value="">Choose…</option>
              {/* A condition's value stays listed even if no file holds it any more */}
              {[...new Set([...(row.value ? [row.value] : []), ...valuesFor(row.property)])].map((v) => (
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
            className="self-start flex items-center gap-1 h-6 px-1.5 ml-[22px] rounded-[6px] text-blue-400 hover:bg-neutral-700/40"
          >
            <SymbolIcon name="plus" size={11} fallback="+" />
            Add Condition
          </button>
        )}
      </div>
    </Dialog>
  );
}
