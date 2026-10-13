import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Property, PropertyValue } from "../../../types";

interface Props {
  fileId: string;
  property: Property;
  currentValue: unknown;
  registeredValues: PropertyValue[];
  onScalarSave: (fileId: string, key: string, value: string | null) => Promise<void>;
  onArrayAdd: (fileId: string, key: string, value: string) => Promise<void>;
  onArrayRemove: (fileId: string, key: string, value: string) => Promise<void>;
  onNewRegistryValue: (propertyId: string, value: string) => Promise<void>;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.length > 0) return [v];
  return [];
}

function asScalar(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

// ─── Dropdown portal ──────────────────────────────────────────────────────────

interface DropdownProps {
  anchor: DOMRect;
  children: React.ReactNode;
  onClose: () => void;
}

function Dropdown({ anchor, children, onClose }: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  const top = anchor.bottom + window.scrollY + 2;
  const left = anchor.left + window.scrollX;

  return createPortal(
    <div
      ref={ref}
      style={{ top, left, minWidth: anchor.width }}
      className="fixed z-50 bg-neutral-800 border border-neutral-600 rounded-md shadow-xl py-0.5 max-h-52 overflow-y-auto text-xs"
    >
      {children}
    </div>,
    document.body
  );
}

// ─── AddValueInput ────────────────────────────────────────────────────────────

interface AddValueInputProps {
  onCommit: (value: string) => void;
  onCancel: () => void;
}

function AddValueInput({ onCommit, onCancel }: AddValueInputProps) {
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && val.trim()) {
      onCommit(val.trim());
    } else if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div className="px-2 py-1 flex items-center gap-1.5">
      <input
        ref={inputRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={handleKey}
        placeholder="New value…"
        className="flex-1 bg-neutral-700 text-neutral-100 text-xs px-1.5 py-0.5 rounded outline-none border border-neutral-500 focus:border-neutral-300"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          if (val.trim()) onCommit(val.trim());
        }}
        className="text-neutral-300 hover:text-white"
      >
        ↵
      </button>
    </div>
  );
}

// ─── MetadataCell ─────────────────────────────────────────────────────────────

export default function MetadataCell({
  fileId,
  property,
  currentValue,
  registeredValues,
  onScalarSave,
  onArrayAdd,
  onArrayRemove,
  onNewRegistryValue,
}: Props) {
  const [open, setOpen] = useState(false);
  const [showAddInput, setShowAddInput] = useState(false);
  const [inlineText, setInlineText] = useState<string | null>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const { value_type, property_id, name } = property;

  function openDropdown() {
    if (!cellRef.current) return;
    setAnchorRect(cellRef.current.getBoundingClientRect());
    setOpen(true);
    setShowAddInput(false);
  }

  function closeDropdown() {
    setOpen(false);
    setShowAddInput(false);
  }

  // ── free_text ──────────────────────────────────────────────────────────────

  function startInlineEdit() {
    setInlineText(asScalar(currentValue));
  }

  async function commitInlineEdit() {
    if (inlineText === null) return;
    const trimmed = inlineText.trim();
    await onScalarSave(fileId, name, trimmed.length > 0 ? trimmed : null);
    setInlineText(null);
  }

  function handleInlineKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitInlineEdit();
    else if (e.key === "Escape") setInlineText(null);
  }

  // ── enum/array add-value ──────────────────────────────────────────────────

  const handleNewRegistryValue = useCallback(
    async (newVal: string) => {
      await onNewRegistryValue(property_id, newVal);
      setShowAddInput(false);
      if (value_type === "enum" || value_type === "date") {
        await onScalarSave(fileId, name, newVal);
        closeDropdown();
      } else if (value_type === "array") {
        await onArrayAdd(fileId, name, newVal);
      }
    },
    [property_id, value_type, fileId, name, onNewRegistryValue, onScalarSave, onArrayAdd]
  );

  // ─── Render cell content ──────────────────────────────────────────────────

  if (value_type === "free_text") {
    if (inlineText !== null) {
      return (
        <div ref={cellRef} className="w-40 shrink-0 px-2 py-0.5">
          <input
            autoFocus
            value={inlineText}
            onChange={(e) => setInlineText(e.target.value)}
            onBlur={commitInlineEdit}
            onKeyDown={handleInlineKey}
            className="w-full bg-neutral-700 text-neutral-100 text-xs px-1.5 py-0.5 rounded outline-none border border-neutral-500 focus:border-neutral-300"
          />
        </div>
      );
    }
    const display = asScalar(currentValue);
    return (
      <div
        ref={cellRef}
        onClick={startInlineEdit}
        className="w-40 shrink-0 px-2 py-0.5 cursor-text hover:bg-neutral-700/40 transition-colors"
      >
        {display.length > 0 ? (
          <span className="text-xs text-neutral-200">{display}</span>
        ) : (
          <span className="text-xs text-neutral-600 italic">—</span>
        )}
      </div>
    );
  }

  if (value_type === "date") {
    if (inlineText !== null) {
      return (
        <div ref={cellRef} className="w-40 shrink-0 px-2 py-0.5">
          <input
            type="date"
            autoFocus
            value={inlineText}
            onChange={(e) => setInlineText(e.target.value)}
            onBlur={commitInlineEdit}
            onKeyDown={handleInlineKey}
            className="bg-neutral-700 text-neutral-100 text-xs px-1.5 py-0.5 rounded outline-none border border-neutral-500 focus:border-neutral-300"
          />
        </div>
      );
    }
    const display = asScalar(currentValue);
    return (
      <div
        ref={cellRef}
        onClick={startInlineEdit}
        className="w-40 shrink-0 px-2 py-0.5 cursor-text hover:bg-neutral-700/40 transition-colors"
      >
        {display.length > 0 ? (
          <span className="text-xs text-neutral-200">{display}</span>
        ) : (
          <span className="text-xs text-neutral-600 italic">—</span>
        )}
      </div>
    );
  }

  if (value_type === "enum") {
    const current = asScalar(currentValue);
    return (
      <div
        ref={cellRef}
        onClick={openDropdown}
        className="w-40 shrink-0 px-2 py-0.5 cursor-pointer hover:bg-neutral-700/40 transition-colors"
      >
        {current.length > 0 ? (
          <span className="text-xs text-neutral-200">{current}</span>
        ) : (
          <span className="text-xs text-neutral-600 italic">—</span>
        )}
        {open && anchorRect && (
          <Dropdown anchor={anchorRect} onClose={closeDropdown}>
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                onScalarSave(fileId, name, null).then(closeDropdown);
              }}
              className="w-full text-left px-3 py-1 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300 italic"
            >
              Clear
            </button>
            {registeredValues.map((rv) => (
              <button
                key={rv.value_id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onScalarSave(fileId, name, rv.value).then(closeDropdown);
                }}
                className={`w-full text-left px-3 py-1 hover:bg-neutral-700 transition-colors ${
                  rv.value === current
                    ? "text-white font-medium"
                    : "text-neutral-200"
                }`}
              >
                {rv.value}
              </button>
            ))}
            <div className="border-t border-neutral-600 mt-0.5">
              {showAddInput ? (
                <AddValueInput
                  onCommit={handleNewRegistryValue}
                  onCancel={() => setShowAddInput(false)}
                />
              ) : (
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setShowAddInput(true);
                  }}
                  className="w-full text-left px-3 py-1 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300"
                >
                  + Add value
                </button>
              )}
            </div>
          </Dropdown>
        )}
      </div>
    );
  }

  // array: multi-select dropdown with checkboxes
  const currentArr = asStringArray(currentValue);
  return (
    <div
      ref={cellRef}
      onClick={openDropdown}
      className="w-40 shrink-0 px-2 py-0.5 cursor-pointer hover:bg-neutral-700/40 transition-colors"
    >
      {currentArr.length > 0 ? (
        <div className="flex flex-wrap gap-0.5">
          {currentArr.map((v) => (
            <span
              key={v}
              className="inline-block px-1.5 py-0.5 rounded text-xs bg-neutral-700 text-neutral-200"
            >
              {v}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-xs text-neutral-600 italic">—</span>
      )}
      {open && anchorRect && (
        <Dropdown anchor={anchorRect} onClose={closeDropdown}>
          {registeredValues.map((rv) => {
            const checked = currentArr.includes(rv.value);
            return (
              <label
                key={rv.value_id}
                className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-neutral-700 transition-colors"
                onMouseDown={(e) => e.preventDefault()}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    if (checked) {
                      onArrayRemove(fileId, name, rv.value);
                    } else {
                      onArrayAdd(fileId, name, rv.value);
                    }
                  }}
                  className="accent-neutral-400"
                />
                <span className="text-xs text-neutral-200">{rv.value}</span>
              </label>
            );
          })}
          <div className="border-t border-neutral-600 mt-0.5">
            {showAddInput ? (
              <AddValueInput
                onCommit={handleNewRegistryValue}
                onCancel={() => setShowAddInput(false)}
              />
            ) : (
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  setShowAddInput(true);
                }}
                className="w-full text-left px-3 py-1 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300"
              >
                + Add value
              </button>
            )}
          </div>
        </Dropdown>
      )}
    </div>
  );
}
