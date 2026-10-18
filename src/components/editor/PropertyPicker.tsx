import { useState, useEffect, useLayoutEffect, useRef } from "react";
import Popover from "../shared/Popover";
import type { Property } from "../../types";
import { getProperties, createProperty } from "../../lib/commands";

interface PropertyPickerProps {
  library: string | null;
  onSelect: (property: Property) => void;
  onClose: () => void;
}

const VALUE_TYPES = ["enum", "free_text", "array", "date"] as const;

export default function PropertyPicker({ library, onSelect, onClose }: PropertyPickerProps) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<string>("enum");
  // Drops down from the element it's placed in, outside the scrolling tree so it isn't clipped
  const markerRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setAnchor(markerRef.current?.parentElement ?? null), []);

  useEffect(() => {
    getProperties(library ?? undefined).then(setProperties).catch(() => {});
  }, [library]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const prop = await createProperty(name, library, newType);
      onSelect(prop);
    } catch {
      // ignore
    }
  }

  return (
    <>
      <span ref={markerRef} hidden />
      {anchor && (
        <Popover anchor={anchor} onClose={onClose} className="w-52">
          {!creating ? (
            <>
              <div className="max-h-48 overflow-y-auto">
                {properties.length === 0 && (
                  <p className="px-3 py-2 text-xs text-neutral-500">No properties yet</p>
                )}
                {properties.map((p) => (
                  <button
                    key={p.property_id}
                    onClick={() => onSelect(p)}
                    className="w-full text-left px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700 transition-colors"
                  >
                    {p.name}
                    <span className="ml-1 text-neutral-500">({p.value_type})</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-neutral-700">
                <button
                  onClick={() => setCreating(true)}
                  className="w-full text-left px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors"
                >
                  + Create new property…
                </button>
              </div>
            </>
          ) : (
            <div className="p-2 flex flex-col gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setCreating(false);
                }}
                data-own-escape
                placeholder="Property name"
                className="w-full bg-neutral-700 text-neutral-100 text-xs px-2 py-1 rounded border border-neutral-600 focus:outline-none focus:border-neutral-400"
              />
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="w-full bg-neutral-700 text-neutral-100 text-xs px-2 py-1 rounded border border-neutral-600 focus:outline-none"
              >
                {VALUE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <div className="flex gap-1">
                <button
                  onClick={handleCreate}
                  className="flex-1 bg-neutral-600 hover:bg-neutral-500 text-neutral-100 text-xs py-1 rounded transition-colors"
                >
                  Create
                </button>
                <button
                  onClick={() => setCreating(false)}
                  className="flex-1 text-neutral-400 hover:text-neutral-200 text-xs py-1 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Popover>
      )}
    </>
  );
}
