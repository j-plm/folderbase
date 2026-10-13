import type { DbFilter, Property, PropertyValue } from "../../../types";

interface Props {
  filters: DbFilter[];
  properties: Property[];
  valuesByPropertyId: Record<string, PropertyValue[]>;
  onRemove: (index: number) => void;
  onClear: () => void;
  onAdd: (f: DbFilter) => void;
}

export default function FilterBar({
  filters,
  properties,
  valuesByPropertyId,
  onRemove,
  onClear,
  onAdd,
}: Props) {
  if (filters.length === 0 && properties.length === 0) return null;

  function handleAddChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const raw = e.target.value;
    if (!raw) return;
    const [propName, val] = raw.split("\0");
    onAdd({ property: propName, value: val });
    e.target.value = "";
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-neutral-700/60 bg-neutral-800/20 shrink-0 min-h-[32px]">
      {filters.map((f, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-neutral-700 text-neutral-200"
        >
          <span className="text-neutral-400">{f.property}:</span>
          {f.value}
          <button
            onClick={() => onRemove(i)}
            className="ml-0.5 text-neutral-400 hover:text-neutral-100 leading-none"
          >
            ×
          </button>
        </span>
      ))}

      {filters.length > 1 && (
        <button
          onClick={onClear}
          className="text-xs text-neutral-500 hover:text-neutral-300 px-1"
        >
          Clear all
        </button>
      )}

      {/* Add filter picker */}
      <select
        onChange={handleAddChange}
        defaultValue=""
        className="text-xs bg-transparent text-neutral-400 hover:text-neutral-200 cursor-pointer outline-none"
      >
        <option value="" disabled>
          + Add filter
        </option>
        {properties.map((p) => {
          const vals = valuesByPropertyId[p.property_id] ?? [];
          if (vals.length === 0) return null;
          return (
            <optgroup key={p.property_id} label={p.name}>
              {vals.map((v) => (
                <option key={v.value_id} value={`${p.name}\0${v.value}`}>
                  {v.value}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}
