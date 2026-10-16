import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Popover from "../../shared/Popover";
import { SymbolIcon } from "../../../lib/fileIcons";
import { showContextMenu, type MenuEntry } from "../../../lib/nativeMenu";
import { formatValue, listValues } from "../../../lib/propertyTypes";
import type { PropertyConfig, ValueType } from "../../../types";

/** Where the selection goes after a commit: Return moves down, Tab across. */
export type CommitMove = "down" | "up" | "right" | "left" | "none";

const MAX_PILLS = 4;

/** A custom property value as shown in its cell: list values as pills, the rest formatted. */
export function PropertyValueView({
  value,
  type,
  config,
  onPillMouseDown,
  wrap = false,
}: {
  value: unknown;
  type: ValueType;
  config: PropertyConfig;
  /** Makes list pills draggable (the Tags property's pills drag onto other columns). */
  onPillMouseDown?: (e: React.MouseEvent, value: string) => void;
  /** Shows every pill, wrapping onto more lines (the row grows to fit). */
  wrap?: boolean;
}) {
  if (type === "enum" || type === "array") {
    const items = listValues(value);
    if (items.length === 0) return null;
    const shown = wrap ? items : items.slice(0, MAX_PILLS);
    return (
      <div className={`flex items-center gap-x-1 ${wrap ? "flex-wrap gap-y-0.5" : "flex-nowrap overflow-hidden"}`}>
        {shown.map((item) => (
          <span
            key={item}
            onMouseDown={onPillMouseDown && ((e) => onPillMouseDown(e, item))}
            className="inline-flex items-center h-4 px-1.5 rounded text-[11px] leading-none whitespace-nowrap shrink-0 bg-neutral-500/15 data-[pressed]:bg-blue-500 data-[pressed]:text-white data-[pressed]:opacity-100"
          >
            {item}
          </span>
        ))}
        {!wrap && items.length > MAX_PILLS && (
          <span className="text-[11px] text-neutral-500 shrink-0">+{items.length - MAX_PILLS}</span>
        )}
      </div>
    );
  }
  return <span className="truncate">{formatValue(value, type, config)}</span>;
}

/**
 * In-place editor for Text, Number and Date cells. Return commits and moves
 * down, Tab commits and moves across, Escape cancels, clicking away commits.
 */
export function TextCellEditor({
  initial,
  type,
  onCommit,
  onCancel,
}: {
  initial: string;
  type: ValueType;
  onCommit: (text: string, move: CommitMove) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  // A date picker only when editing an existing date; typed-in text stays a text field
  const asDate = type === "date" && (initial === "" || /^\d{4}-\d{2}-\d{2}$/.test(initial));

  function finish(move: CommitMove) {
    if (done.current) return;
    done.current = true;
    onCommit(text, move);
  }

  return (
    <input
      autoFocus
      type={asDate ? "date" : "text"}
      inputMode={type === "number" ? "decimal" : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => {
        // Typing into a cell replaces it; Return/double-click puts the caret at the end
        const el = e.currentTarget;
        if (el.type === "text") el.setSelectionRange(el.value.length, el.value.length);
      }}
      onBlur={() => finish("none")}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(e.shiftKey ? "up" : "down");
        } else if (e.key === "Tab") {
          e.preventDefault();
          finish(e.shiftKey ? "left" : "right");
        } else if (e.key === "Escape") {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      // The cell's selection outline frames the field
      className={`w-full h-[18px] bg-transparent text-neutral-100 outline-none text-body ${
        type === "number" ? "text-right" : ""
      }`}
    />
  );
}

/**
 * Value picker for Select and Multi-select cells: the registered values with
 * the cell's checked, a field that filters them, and "Add" for a new value.
 * A Select commits on the first pick; a Multi-select stays open for more.
 */
export function ListCellEditor({
  anchor,
  value,
  multiple,
  options,
  seed = "",
  onCommit,
  onClose,
  onDeleteValue,
  usage,
  onRenameValue,
  sourcesOf,
}: {
  anchor: HTMLElement;
  value: unknown;
  multiple: boolean;
  options: string[];
  /** Text typed into the cell that opened the picker. */
  seed?: string;
  onCommit: (value: unknown, move: CommitMove) => void;
  onClose: () => void;
  /** Deletes a value from the property and every file that has it. */
  onDeleteValue?: (value: string) => Promise<void>;
  /** How many files have a value, for the delete confirmation. */
  usage?: (value: string) => number;
  /** Renames a value in the property and every file that has it. */
  onRenameValue?: (from: string, to: string) => Promise<void>;
  /** Folder names a value was renamed from, shown greyed beside it. */
  sourcesOf?: (value: string) => string[];
}) {
  const [chosen, setChosen] = useState<string[]>(() => listValues(value));
  const [query, setQuery] = useState(seed);
  const [highlight, setHighlight] = useState(0);
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;

  /** Values deleted or renamed while the picker is open, shown as they'll be before the reload catches up. */
  const [removed, setRemoved] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const all = useMemo(
    () =>
      [...new Set([...options, ...listValues(value), ...added])]
        .filter((o) => !removed.includes(o))
        .sort((a, b) => a.localeCompare(b)),
    [options, value, removed, added]
  );

  async function deleteValue(item: string) {
    setRemoved((r) => [...r, item]);
    setChosen((c) => c.filter((x) => x !== item));
    await onDeleteValue?.(item);
  }

  async function renameValue(from: string, to: string) {
    const name = to.trim();
    if (!name || name === from) return;
    setRemoved((r) => [...r.filter((x) => x !== name), from]);
    setAdded((a) => [...a, name]);
    // Ticked under its old name: stays ticked under the new one (not written back as the old name)
    setChosen((c) => [...new Set(c.map((x) => (x === from ? name : x)))]);
    await onRenameValue?.(from, name);
  }
  const q = query.trim();
  const shown = q ? all.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : all;
  const canAdd = q !== "" && !all.some((o) => o.toLowerCase() === q.toLowerCase());
  // Rows: matching values, then "Add" when the text is new
  const rowCount = shown.length + (canAdd ? 1 : 0);

  useEffect(() => setHighlight(0), [query]);

  // Take the keyboard once placed, caret after any text typed into the cell
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el || document.activeElement === el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Multi-select commits what's ticked when it closes
  const committed = useRef(false);
  function close(move: CommitMove = "none") {
    if (multiple && !committed.current) {
      committed.current = true;
      onCommit(chosenRef.current.length ? chosenRef.current : null, move);
    }
    onClose();
  }

  function pick(item: string) {
    if (!multiple) {
      committed.current = true;
      onCommit(item, "down");
      onClose();
      return;
    }
    setChosen((c) => (c.includes(item) ? c.filter((x) => x !== item) : [...c, item]));
    setQuery("");
  }

  function activate(index: number) {
    if (index < shown.length) pick(shown[index]);
    else if (canAdd) pick(q);
  }

  return (
    <Popover anchor={anchor} onClose={() => close()} className="w-[220px] p-[5px]">
      <input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder={multiple ? "Find or add values" : "Find or add a value"}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(rowCount - 1, h + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(0, h - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (rowCount > 0 && (q !== "" || !multiple)) activate(highlight);
            else close("down");
          } else if (e.key === "Tab") {
            e.preventDefault();
            close(e.shiftKey ? "left" : "right");
          }
          // Escape is handled by the popover: it closes, keeping a Multi-select's ticks
        }}
        className="w-full h-6 mb-1 px-1.5 rounded-[6px] bg-neutral-900 border border-neutral-600/70 text-body text-neutral-100 outline-none focus:border-blue-500"
      />
      <div role="listbox" aria-multiselectable={multiple} className="max-h-[240px] overflow-y-auto">
        {!multiple && chosen.length > 0 && q === "" && (
          <OptionRow label="None" checked={false} highlighted={false} muted onClick={() => {
            committed.current = true;
            onCommit(null, "down");
            onClose();
          }} />
        )}
        {shown.map((item, i) => (
          <OptionRow
            key={item}
            label={item}
            checked={chosen.includes(item)}
            highlighted={i === highlight && q !== ""}
            onClick={() => pick(item)}
            onDelete={onDeleteValue ? () => deleteValue(item) : undefined}
            onRename={onRenameValue ? (to) => renameValue(item, to) : undefined}
            sources={sourcesOf?.(item)}
            usage={usage?.(item)}
          />
        ))}
        {canAdd && (
          <OptionRow
            label={`Add “${q}”`}
            checked={false}
            highlighted={highlight === shown.length}
            icon="plus"
            onClick={() => pick(q)}
          />
        )}
        {rowCount === 0 && <p className="px-2 py-1 text-neutral-500">Type to add a value</p>}
      </div>
      {multiple && (
        <div className="flex justify-end pt-1 mt-1 border-t border-neutral-700/60">
          <button
            type="button"
            onClick={() => close("none")}
            className="h-6 px-3 rounded-[6px] bg-blue-500 text-white text-body"
          >
            Done
          </button>
        </div>
      )}
    </Popover>
  );
}

/**
 * A list property's values, for editing the list itself rather than a cell:
 * opened from the column's menu. Type to find or add a value; click a value to
 * rename it, or right-click for Rename and Delete.
 */
export function ValueListEditor({
  anchor,
  property,
  options,
  sourcesOf,
  usage,
  onAdd,
  onRename,
  onDelete,
  onClose,
}: {
  anchor: HTMLElement;
  property: string;
  options: string[];
  sourcesOf: (value: string) => string[];
  usage: (value: string) => number;
  onAdd: (value: string) => Promise<void>;
  onRename: (from: string, to: string) => Promise<void>;
  onDelete: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const all = useMemo(
    () =>
      [...new Set([...options, ...added])].filter((o) => !removed.includes(o)).sort((a, b) => a.localeCompare(b)),
    [options, added, removed]
  );
  const q = query.trim();
  const shown = q ? all.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : all;
  const canAdd = q !== "" && !all.some((o) => o.toLowerCase() === q.toLowerCase());

  function add() {
    if (!canAdd) return;
    setAdded((a) => [...a, q]);
    setRemoved((r) => r.filter((x) => x !== q));
    setQuery("");
    void onAdd(q);
  }

  async function rename(from: string, to: string) {
    const name = to.trim();
    if (!name || name === from) return;
    setRemoved((r) => [...r.filter((x) => x !== name), from]);
    setAdded((a) => [...a, name]);
    await onRename(from, name);
  }

  async function remove(value: string) {
    setRemoved((r) => [...r, value]);
    await onDelete(value);
  }

  return (
    <Popover anchor={anchor} onClose={onClose} className="w-[240px] p-[5px]">
      <p className="px-1.5 pb-1 text-xs font-semibold text-neutral-500 truncate">{property}</p>
      <input
        autoFocus
        value={query}
        placeholder="Find or add a value"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        className="w-full h-6 mb-1 px-1.5 rounded-[6px] bg-neutral-900 border border-neutral-600/70 text-body text-neutral-100 outline-none focus:border-blue-500"
      />
      <div role="listbox" className="max-h-[280px] overflow-y-auto">
        {shown.map((item) => (
          <OptionRow
            key={item}
            label={item}
            checked={false}
            highlighted={false}
            renameOnClick
            onClick={() => {}}
            onRename={(to) => rename(item, to)}
            onDelete={() => remove(item)}
            sources={sourcesOf(item)}
            usage={usage(item)}
          />
        ))}
        {canAdd && (
          <OptionRow label={`Add “${q}”`} checked={false} highlighted icon="plus" onClick={add} />
        )}
        {shown.length === 0 && !canAdd && <p className="px-2 py-1 text-neutral-500">Type to add a value</p>}
      </div>
      <p className="px-1.5 pt-1 mt-1 border-t border-neutral-700/60 text-[11px] text-neutral-500">
        Click a value to rename it. Right-click for more.
      </p>
    </Popover>
  );
}

/** Hovering this long over a value reveals its delete button. */
const DELETE_REVEAL_MS = 700;

function OptionRow({
  label,
  checked,
  highlighted,
  muted,
  icon,
  onClick,
  onDelete,
  onRename,
  renameOnClick,
  sources,
  usage,
}: {
  label: string;
  checked: boolean;
  highlighted: boolean;
  muted?: boolean;
  icon?: string;
  onClick: () => void;
  /** Offers deleting the value after a hover, with a confirmation in the row. */
  onDelete?: () => void;
  /** Offers renaming the value in place (right-click ▸ Rename). */
  onRename?: (to: string) => void;
  /** Clicking the row renames it (when editing the list rather than a cell). */
  renameOnClick?: boolean;
  /** Folder names the value was renamed from, shown greyed beside it. */
  sources?: string[];
  usage?: number;
}) {
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function leave() {
    window.clearTimeout(timer.current);
    setRevealed(false);
    setConfirming(false);
  }

  function showMenu(e: React.MouseEvent) {
    if (!onRename && !onDelete) return;
    e.preventDefault();
    e.stopPropagation();
    const entries: MenuEntry[] = [];
    if (onRename) entries.push({ type: "item", text: "Rename…", action: () => setRenaming(true) });
    if (onDelete) entries.push({ type: "item", text: "Delete…", action: () => setConfirming(true) });
    showContextMenu(entries, { event: e });
  }

  if (renaming) {
    return (
      <div role="option" aria-selected={checked} className="w-full h-6 flex items-center pl-1.5 pr-0.5">
        <span className="w-4 shrink-0" />
        <RenameField
          initial={label}
          onDone={(text) => {
            setRenaming(false);
            if (text != null) onRename?.(text);
          }}
        />
      </div>
    );
  }

  if (confirming) {
    return (
      <div
        role="option"
        aria-selected={checked}
        onMouseLeave={leave}
        className="w-full h-6 flex items-center gap-1.5 pl-1.5 pr-0.5 rounded-[6px] bg-red-900"
      >
        <span className="flex-1 min-w-0 truncate text-red-300">
          Delete “{label}”{usage ? ` from ${usage} file${usage === 1 ? "" : "s"}` : ""}?
        </span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            leave();
            onDelete?.();
          }}
          className="h-5 px-2 rounded-[5px] bg-red-500 text-white text-xs shrink-0"
        >
          Delete
        </button>
      </div>
    );
  }

  return (
    <div
      role="option"
      aria-selected={checked}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => {
        if (!onDelete) return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setRevealed(true), DELETE_REVEAL_MS);
      }}
      onMouseLeave={leave}
      onClick={renameOnClick && onRename ? () => setRenaming(true) : onClick}
      onContextMenu={showMenu}
      className={`group w-full h-6 flex items-center gap-1 pl-1.5 rounded-[6px] text-left whitespace-nowrap cursor-default hover:bg-blue-500 hover:text-white ${
        revealed ? "pr-0.5" : "pr-3"
      } ${highlighted ? "bg-blue-500 text-white" : muted ? "text-neutral-400" : ""}`}
    >
      <span className="w-4 flex justify-center shrink-0">
        {checked && <SymbolIcon name="checkmark" size={11} fallback="✓" />}
        {icon && <SymbolIcon name={icon} size={11} fallback="+" />}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      {/* Where a renamed value came from */}
      {sources && sources.length > 0 && (
        <span title={`Folder: ${sources.join(", ")}`} className="min-w-0 truncate text-[11px] opacity-50">
          {sources.join(", ")}
        </span>
      )}
      <span className="flex-1" />
      {revealed && (
        <button
          type="button"
          title="Delete Value"
          aria-label={`Delete ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(true);
          }}
          className="w-5 h-5 shrink-0 flex items-center justify-center rounded-[5px] hover:bg-white/20"
        >
          <SymbolIcon name="trash" size={11} fallback="✕" />
        </button>
      )}
    </div>
  );
}

/** A value's new name typed in place: Return or clicking away commits, Escape keeps the old name (null). */
function RenameField({ initial, onDone }: { initial: string; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  function finish(commit: boolean) {
    if (done.current) return;
    done.current = true;
    onDone(commit ? text : null);
  }
  return (
    <input
      autoFocus
      data-own-escape
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 h-5 px-1 rounded-[4px] bg-neutral-900 text-body text-neutral-100 outline-2 outline-blue-500"
    />
  );
}

/**
 * A column's name edited in place in its header, as Numbers does: the text
 * starts selected, Return or clicking away commits, Escape keeps the old name.
 */
export function HeaderNameEditor({
  initial,
  error,
  onCommit,
  onCancel,
}: {
  initial: string;
  /** Why the last commit failed (e.g. the name is taken); keeps the field open. */
  error?: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const done = useRef(false);

  function finish(commit: boolean) {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(text);
    else onCancel();
  }

  return (
    <input
      autoFocus
      value={text}
      title={error}
      aria-invalid={!!error}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => {
        e.currentTarget.select();
        e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
      }}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={`w-full min-w-0 h-[18px] px-1 -mx-1 rounded-[3px] bg-neutral-900 text-xs text-neutral-100 font-normal outline-2 ${
        error ? "outline-red-500" : "outline-blue-500"
      }`}
    />
  );
}
