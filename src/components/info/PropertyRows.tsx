import { useRef, useState } from "react";
import { ListCellEditor, PropertyValueView, TextCellEditor } from "../views/db/CellEditors";
import { editText, formatValue, listValues, parseInput } from "../../lib/propertyTypes";
import { listEdits, setEdits, sharedValue, valueCounts } from "../../lib/info";
import type { CellEdit } from "../../lib/commands";
import type { FileRecord, PropertyConfig, ValueType } from "../../types";

/*
 * One custom property in Get Info or the Inspector, edited with the Database
 * view's cell editors. With several files it shows the value they share, or
 * "Mixed"; an edit applies to all of them. A Multi-select shows each value
 * every file holds, and fainter those only some hold (✕ takes one off all).
 */

export interface PropertyRowProps {
  name: string;
  label?: string;
  type: ValueType;
  config: PropertyConfig;
  files: FileRecord[];
  /** Registered values, for Select and Multi-select. */
  options: string[];
  /** Writes the edits as one undoable change, named `label`. */
  onEdit: (edits: CellEdit[], label: string) => void;
}

const read = (key: string) => (f: FileRecord) => (f.metadata ?? {})[key] ?? null;

export function PropertyRow({ name, label = name, type, config, files, options, onEdit }: PropertyRowProps) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-start gap-x-2 min-h-[22px]">
      <span className="text-right text-neutral-400 truncate pt-[3px]" title={label}>
        {label}:
      </span>
      <PropertyValue name={name} type={type} config={config} files={files} options={options} onEdit={onEdit} />
    </div>
  );
}

export function PropertyValue({ name, type, config, files, options, onEdit, placeholder = "Add" }: PropertyRowProps & { placeholder?: string }) {
  const list = type === "enum" || type === "array";
  return list ? (
    <ListValue name={name} type={type} config={config} files={files} options={options} onEdit={onEdit} placeholder={placeholder} />
  ) : (
    <TextValue name={name} type={type} config={config} files={files} options={options} onEdit={onEdit} />
  );
}

function TextValue({ name, type, config, files, onEdit }: PropertyRowProps) {
  const [editing, setEditing] = useState(false);
  const shared = sharedValue(files, read(name), type);
  const current = shared.kind === "same" ? shared.value : null;

  if (editing) {
    return (
      <div className="rounded-[4px] px-1 py-px bg-neutral-800 ring-2 ring-blue-500/60">
        <TextCellEditor
          initial={shared.kind === "same" ? editText(current, type, config) : ""}
          type={type}
          onCancel={() => setEditing(false)}
          onCommit={(text) => {
            setEditing(false);
            // Left empty on Mixed: nothing typed, nothing changed
            if (shared.kind === "mixed" && text.trim() === "") return;
            const edits = setEdits(files, name, parseInput(text, type, config));
            if (edits.length > 0) onEdit(edits, `Edit ${name}`);
          }}
        />
      </div>
    );
  }
  const text = shared.kind === "mixed" ? "Mixed" : formatValue(current, type, config);
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`text-left min-w-0 rounded-[4px] px-1 py-px -mx-px hover:bg-neutral-500/10 ${text ? "" : "text-neutral-500"} ${
        shared.kind === "mixed" ? "italic text-neutral-400" : ""
      } ${type === "number" ? "tabular-nums" : ""}`}
    >
      <span className="block truncate">{text || "None"}</span>
    </button>
  );
}

function ListValue({ name, type, files, options, onEdit, placeholder = "Add" }: PropertyRowProps & { placeholder?: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const multiple = type === "array";
  const counts = valueCounts(files, read(name));
  // Ticked in the picker: what every file holds
  const everywhere = counts.filter((c) => c.count === files.length).map((c) => c.value);
  const some = counts.filter((c) => c.count < files.length);

  const commit = (picked: unknown) => {
    const next = listValues(picked);
    const added = next.filter((v) => !everywhere.includes(v));
    const removed = everywhere.filter((v) => !next.includes(v));
    const edits = listEdits(files, name, added, removed, multiple);
    if (edits.length > 0) onEdit(edits, `Edit ${name}`);
  };
  const removeFromAll = (value: string) => {
    const edits = listEdits(files, name, [], [value], multiple);
    if (edits.length > 0) onEdit(edits, `Remove “${value}”`);
  };

  return (
    <div className="min-w-0 flex flex-wrap items-center gap-1 py-px">
      {everywhere.length > 0 && <PropertyValueView value={everywhere} type="array" config={{}} wrap />}
      {some.map((c) => (
        <span
          key={c.value}
          title={`On ${c.count} of ${files.length} items`}
          className="group inline-flex items-center gap-0.5 h-4 px-1.5 rounded text-[11px] leading-none whitespace-nowrap bg-neutral-500/10 text-neutral-400"
        >
          {c.value}
          <button
            type="button"
            aria-label={`Remove “${c.value}” from all`}
            onClick={() => removeFromAll(c.value)}
            className="hidden group-hover:inline opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </span>
      ))}
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen(true)}
        className="h-4 px-1 rounded text-[11px] leading-none text-neutral-500 hover:text-neutral-200 hover:bg-neutral-500/10"
      >
        {counts.length === 0 ? `${placeholder}…` : multiple ? "+" : "Change…"}
      </button>
      {open && anchor.current && (
        <ListCellEditor
          anchor={anchor.current}
          value={everywhere}
          multiple={multiple}
          options={options}
          onCommit={(value) => commit(value)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** A value read from the file (EXIF), shown as plain text: editing them comes with Editing Media Properties. */
export function ReadOnlyRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-baseline gap-x-2">
      <span className="text-right text-neutral-400 truncate">{label}:</span>
      <span className="min-w-0 break-words select-text">{text}</span>
    </div>
  );
}
