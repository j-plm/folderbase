import { useRef } from "react";
import type React from "react";
import { FolderIcon, SymbolIcon } from "../../lib/fileIcons";
import type { ValueReader } from "../../lib/fileValues";
import {
  chainAt,
  chainFiles,
  levelExamples,
  removeFork,
  removeLevel,
  setLevel,
  type ChainAddress,
  type LevelSlot,
} from "../../lib/hierarchy";
import { NO_VALUE, folderColumnLabel, noValuePlacement } from "../../lib/folderTree";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import { DATE_UNITS, dateUnitsFor, defaultDateUnit, isDateColumn } from "../../lib/dateFolders";
import { PROP_PREFIX, propName } from "../../lib/fileColumns";
import type { FolderLevel } from "../../lib/tableViews";
import type { FileRecord, ValueType } from "../../types";

/** What's being dragged: a property from the list, or a level of the hierarchy. */
export type DragItem = { kind: "property"; column: string; label: string } | { kind: "level"; slot: LevelSlot; label: string };

/** Where it would land: at a slot in a chain, or onto one folder of a level (a fork). */
export type DropTarget = { kind: "slot"; slot: LevelSlot } | { kind: "fork"; slot: LevelSlot; value: string };

/** What a drop target element says about itself (`data-drop`), read as the pointer moves. */
export type DropMark = DropTarget | { kind: "row"; slot: LevelSlot };

export const sameSlot = (a: LevelSlot, b: LevelSlot) => a.index === b.index && JSON.stringify(a.chain) === JSON.stringify(b.chain);

/** A column's type, as a symbol beside its name. */
export function columnSymbol(column: string, typeOf: (name: string) => ValueType): string {
  if (column.startsWith(PROP_PREFIX)) {
    switch (typeOf(propName(column))) {
      case "enum":
        return "list.bullet";
      case "array":
        return "tag";
      case "number":
        return "number";
      case "date":
        return "calendar";
      default:
        return "textformat";
    }
  }
  return { type: "doc", ext: "doc.text", created: "calendar", modified: "calendar", size: "ruler", tags: "folder" }[column] ?? "doc";
}

/** The levels' columns: the level, its order, then its settings as checkboxes under labelled headers. */
export const LEVEL_GRID = "grid grid-cols-[minmax(0,1fr)_52px_56px_56px_56px_22px] items-center";

export interface HierarchyProps {
  root: FolderLevel | null;
  /** The view's files, which the folders are made of. */
  files: FileRecord[];
  reader: ValueReader;
  typeOf: (name: string) => ValueType;
  /** Where a drag would land now, to show it. */
  target: DropTarget | null;
  /** What's being dragged, if anything. */
  dragging: DragItem | null;
  /** The level a drag has rested on, which opens its folders to drop onto. */
  hovered: LevelSlot | null;
  /** The level a drag is resting on before it opens: blue, then blinking just before. */
  spring: { level: LevelSlot; flashing: boolean } | null;
  /** The level clicked last, which shows its folders and which – removes. */
  selected: LevelSlot | null;
  onSelect: (slot: LevelSlot | null) => void;
  onStartDrag: (e: React.MouseEvent, item: DragItem) => void;
  onChange: (root: FolderLevel | null) => void;
}

const noValueLabel = (column: string) => `No ${folderColumnLabel(column)}`;

/** Whether a level can show all its values: a Select or Multi-select, whose values are registered. */
export const isListed = (column: string, typeOf: (name: string) => ValueType) =>
  column.startsWith(PROP_PREFIX) && ["enum", "array"].includes(typeOf(propName(column)));

/** How long a level held under a drag blinks just before it springs open. */
export const SPRING_FLASH = 300;

/** A level's folders shown to drop a property on, at most (a date by day can make thousands). */
const FOLDER_CHIPS = 40;

/** How far each branch's levels sit in from its folder. */
const STEP = 28;

/** Indent of a level or branch inside branches, in the first column. */
const indent = (depth: number) => ({ paddingLeft: 6 + depth * STEP });

/** A line down from each enclosing branch's folder, so what's inside it reads as inside it. */
function Guides({ depth }: { depth: number }) {
  return (
    <>
      {Array.from({ length: depth }, (_, k) => (
        // Under the branch row's folder icon: past its padding, disclosure arrow and gap, then half the icon
        <span key={k} style={{ left: 6 + k * STEP + 12 + 6 + 8 }} className="pointer-events-none absolute top-0 bottom-0 w-px bg-neutral-600/60" />
      ))}
    </>
  );
}

/** The hierarchy as an outline: levels in order, each branch a folder row with its own levels under it. */
export default function HierarchyLevels(props: HierarchyProps) {
  if (!props.root) {
    const slot: LevelSlot = { chain: [], index: 0 };
    const over = props.target?.kind === "slot" && sameSlot(props.target.slot, slot);
    return (
      <div
        data-drop={JSON.stringify({ kind: "slot", slot })}
        className={`mx-2 my-2 px-3 py-5 rounded-md border border-dashed text-center text-xs ${
          over ? "border-blue-500 bg-blue-500/10 text-neutral-200" : "border-neutral-600 text-neutral-500"
        }`}
      >
        No folders: the view shows its files as they are. Drag a property here, and its values become the folders.
      </div>
    );
  }
  const end: LevelSlot = { chain: [], index: chainAt(props.root, []).length };
  const overEnd = props.target?.kind === "slot" && sameSlot(props.target.slot, end);
  return (
    <>
      <Chain {...props} chain={[]} />
      {/* Below the levels: a drop anywhere here goes at the end, shown with the same line as between rows */}
      <div
        data-drop={JSON.stringify({ kind: "slot", slot: end })}
        onMouseDown={() => props.onSelect(null)}
        className={`relative ${props.dragging ? "h-10" : "h-3"}`}
      >
        {overEnd && <DropLine />}
      </div>
    </>
  );
}

/** The folder a chain is a branch inside, shown inline before its first level. */
interface BranchLead {
  label: string;
  /** Removing the branch's first level: the branch itself when it's the only one. */
  onRemove: () => void;
  onRemoveBranch: () => void;
}

function Chain(props: HierarchyProps & { chain: ChainAddress; lead?: BranchLead }) {
  const { root, chain, files, reader, typeOf, lead } = props;
  const levels = chainAt(root, chain);
  // Inside a fork, the examples are that folder's own
  const seen = chain.length > 0 ? chainFiles(files, root, chain, reader, typeOf) : files;

  return (
    <>
      {levels.map((level, index) => {
        const slot: LevelSlot = { chain, index };
        // Every folder, the "No X" one too even where it's switched off
        const examples = levelExamples(seen, { ...level, noValue: "folder" }, reader, typeOf, noValueLabel(level.column), Infinity);
        return (
          <div key={`${index}:${level.column}`}>
            <LevelRow
              {...props}
              slot={slot}
              level={level}
              examples={examples}
              last={index === levels.length - 1}
              lead={index === 0 ? lead : undefined}
            />
            {Object.entries(level.branches).map(([value, fork]) => (
              <Branch
                key={value}
                {...props}
                slot={slot}
                value={value}
                fork={fork}
                label={value === NO_VALUE ? noValueLabel(level.column) : (examples.values.find((v) => v.value === value)?.label ?? value)}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

/**
 * One folder of a level with levels of its own, indented under that level:
 * the folder inline before its first level, the rest of its levels under
 * that (as a chain's levels always are), or the folder alone when it stops
 * there ("files only").
 */
function Branch(props: HierarchyProps & { chain: ChainAddress; slot: LevelSlot; value: string; fork: FolderLevel | null; label: string }) {
  const { root, chain, slot, value, fork, label, target, onChange } = props;
  const inside: ChainAddress = [...chain, { index: slot.index, value }];
  const removeBranch = () => onChange(removeFork(root, slot, value));

  if (fork !== null) {
    const onRemove = () => (fork.next ? onChange(removeLevel(root, { chain: inside, index: 0 })) : removeBranch());
    return <Chain {...props} chain={inside} lead={{ label, onRemove, onRemoveBranch: removeBranch }} />;
  }

  const headSlot: LevelSlot = { chain: inside, index: 0 };
  const headOver = target?.kind === "slot" && sameSlot(target.slot, headSlot);
  return (
    <div
      data-drop={JSON.stringify({ kind: "slot", slot: headSlot })}
      onContextMenu={(e) => {
        e.preventDefault();
        showContextMenu([{ type: "item", text: "Remove Branch", action: removeBranch }], { event: e });
      }}
      className={`${LEVEL_GRID} relative group h-7 rounded-md cursor-default select-none`}
    >
      <div style={indent(inside.length)} className="relative self-stretch flex items-center gap-1.5 min-w-0">
        <Guides depth={inside.length} />
        <span className="shrink-0 w-3" />
        <FolderLabel label={label} />
        <span className="shrink-0 text-[11px] text-neutral-500">files only</span>
      </div>
      <span className="col-span-4" />
      <RowButton symbol="minus.circle" label={`Remove the branch inside “${label}”`} onClick={removeBranch} hover />
      {headOver && <DropLine />}
    </div>
  );
}

/** A branch's folder, as it leads its row. */
function FolderLabel({ label }: { label: string }) {
  return (
    <span className="shrink min-w-[48px] max-w-[45%] flex items-center gap-1.5">
      <FolderIcon size={16} />
      <span className="truncate text-[13px] text-neutral-200">{label}</span>
    </span>
  );
}

function LevelRow({
  root,
  reader,
  chain,
  slot,
  level,
  examples,
  typeOf,
  target,
  dragging,
  hovered,
  spring,
  selected,
  onSelect,
  onStartDrag,
  onChange,
  last,
  lead,
}: HierarchyProps & {
  chain: ChainAddress;
  slot: LevelSlot;
  level: FolderLevel;
  examples: ReturnType<typeof levelExamples>;
  last: boolean;
  lead?: BranchLead;
}) {
  const name = folderColumnLabel(level.column);
  const over = target?.kind === "slot" && sameSlot(target.slot, slot);
  // The last row's lower half takes a drop at the end of its chain (there's no Files row: files show at every level)
  const overEnd = last && chain.length > 0 && target?.kind === "slot" && sameSlot(target.slot, { ...slot, index: slot.index + 1 });
  const forkOver = target?.kind === "fork" && sameSlot(target.slot, slot) ? target.value : null;
  const isSelected = !!selected && sameSlot(selected, slot);
  // Where the press was, so a click that ends a drag doesn't pick the level
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const loose = noValuePlacement(level, reader) === "loose";
  // Leaving out the level's own default (loose for a conditional property, a folder otherwise)
  const place = (where: "loose" | "folder") =>
    set({ noValue: where === noValuePlacement({ column: level.column }, reader) ? undefined : where });
  const none = examples.values.find((v) => v.value === NO_VALUE);
  const named = examples.values.filter((v) => v.value !== NO_VALUE);
  const listed = isListed(level.column, typeOf);
  const set = (patch: Parameters<typeof setLevel>[2]) => onChange(setLevel(root, slot, patch));
  const remove = () => {
    onSelect(null);
    if (lead) lead.onRemove();
    else onChange(removeLevel(root, slot));
  };
  // A date's folders: by year, quarter, month… (one property, any of them)
  const dated = isDateColumn(level.column, typeOf);
  const unit = level.dateUnit ?? defaultDateUnit(level.column);
  const numeric = ["calendar", "number", "ruler"].includes(columnSymbol(level.column, typeOf));
  const unitEntries = (): MenuEntry[] =>
    dateUnitsFor(level.column).map((u) => ({
      type: "check",
      text: `${u.label} (${u.example})`,
      checked: u.unit === unit,
      key: u.unit,
      // The column's own default is left out of the level, as one that never chose
      action: () => set({ dateUnit: u.unit === defaultDateUnit(level.column) ? undefined : u.unit }),
    }));
  // Its folders show when it's picked, and while something's dragged over it (to drop onto one), unless it's the one dragged
  const draggedItself = dragging?.kind === "level" && sameSlot(dragging.slot, slot);
  const showFolders = isSelected || (!!hovered && sameSlot(hovered, slot) && !draggedItself);
  const springing = !!spring && sameSlot(spring.level, slot) && !draggedItself && !showFolders;

  return (
    <>
      <div
        data-drop={JSON.stringify({ kind: "row", slot })}
        data-level={JSON.stringify(slot)}
        onMouseDown={(e) => {
          pressedAt.current = { x: e.clientX, y: e.clientY };
          onStartDrag(e, { kind: "level", slot, label: name });
        }}
        // A click picks it (its folders show) or unpicks it; not a drag, nor a click on its checkboxes (their presses stop short of the row)
        onClick={(e) => {
          const at = pressedAt.current;
          pressedAt.current = null;
          if (!at || Math.hypot(e.clientX - at.x, e.clientY - at.y) >= 4) return;
          onSelect(isSelected ? null : slot);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect(slot);
          showContextMenu(
            [
              { type: "check", text: "Ascending", checked: level.direction === "asc", action: () => set({ direction: "asc" }) },
              { type: "check", text: "Descending", checked: level.direction === "desc", action: () => set({ direction: "desc" }) },
              ...(dated ? [{ type: "separator" as const }, { type: "submenu" as const, text: "Folders By", items: unitEntries() }] : []),
              { type: "separator" },
              {
                type: "submenu",
                text: "Files Without a Value",
                items: [
                  { type: "check", text: `In a “${noValueLabel(level.column)}” Folder`, checked: !loose, action: () => place("folder") },
                  { type: "check", text: "Loose in the Parent Folder", checked: loose, action: () => place("loose") },
                ],
              },
              ...(listed
                ? [
                    {
                      type: "check" as const,
                      text: "Show All Values",
                      checked: !!level.allValues,
                      action: () => set({ allValues: level.allValues ? undefined : true }),
                    },
                  ]
                : []),
              {
                type: "check",
                text: "Skip Single Folders",
                checked: !!level.skipSingle,
                action: () => set({ skipSingle: level.skipSingle ? undefined : true }),
              },
              { type: "separator" },
              { type: "item", text: `Remove “${name}”`, action: remove },
              ...(lead ? [{ type: "item" as const, text: "Remove Branch", action: lead.onRemoveBranch }] : []),
            ],
            { event: e }
          );
        }}
        className={`${LEVEL_GRID} relative group h-7 rounded-md cursor-default select-none ${
          isSelected ? "bg-neutral-800 dark:bg-neutral-700/60" : "hover:bg-neutral-800/50"
        }`}
      >
        <div style={indent(chain.length)} className="relative self-stretch flex items-center gap-1.5 min-w-0">
          <Guides depth={chain.length} />
          <SymbolIcon name="line.3.horizontal" size={10} fallback="≡" className="shrink-0 w-3 text-neutral-500 opacity-0 group-hover:opacity-100" />
          {lead && (
            <>
              <FolderLabel label={lead.label} />
              <SymbolIcon name="chevron.right" size={8} fallback="›" className="shrink-0 text-neutral-500" />
            </>
          )}
          <SymbolIcon name={columnSymbol(level.column, typeOf)} size={13} fallback="•" className="shrink-0 w-4 text-neutral-400" />
          <span className="shrink min-w-0 truncate text-[13px] text-neutral-100">{name}</span>
          {dated && (
            <button
              type="button"
              title="What this level's folders are"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => showContextMenu(unitEntries(), { event: e, alignKey: unit })}
              className="shrink-0 flex items-center gap-0.5 px-1 h-[18px] rounded text-[11px] text-neutral-400 hover:bg-neutral-700/60 hover:text-neutral-100"
            >
              by {DATE_UNITS.find((u) => u.unit === unit)?.label ?? unit}
              <SymbolIcon name="chevron.down" size={7} fallback="▾" />
            </button>
          )}
          <span className="flex-1" />
          <span className="shrink-0 pr-1 text-[11px] tabular-nums text-neutral-500">
            {named.length === 0 ? "No folders yet" : `${named.length.toLocaleString()} ${named.length === 1 ? "folder" : "folders"}`}
          </span>
        </div>
        <div className="flex justify-center">
          <button
            type="button"
            title={level.direction === "asc" ? "Ascending: click for descending" : "Descending: click for ascending"}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => set({ direction: level.direction === "asc" ? "desc" : "asc" })}
            className="px-1.5 h-5 rounded text-[11px] tabular-nums text-neutral-300 hover:bg-neutral-700/60 hover:text-neutral-100"
          >
            {numeric ? (level.direction === "asc" ? "1–9" : "9–1") : level.direction === "asc" ? "A–Z" : "Z–A"}
          </button>
        </div>
        <Cell>
          {listed && (
            <Check
              checked={!!level.allValues}
              label="Every value shows as a folder, even with no files yet"
              onChange={(on) => set({ allValues: on ? true : undefined })}
            />
          )}
        </Cell>
        <Cell>
          <Check
            checked={!!level.skipSingle}
            label="A folder holding just one folder, and no files, shows merged with it (“2024 › Tax”)"
            onChange={(on) => set({ skipSingle: on ? true : undefined })}
          />
        </Cell>
        <Cell>
          <Check
            checked={!loose}
            label={`Files without a ${name} go in a “${noValueLabel(level.column)}” folder; off, they sit loose in the parent folder`}
            onChange={(on) => place(on ? "folder" : "loose")}
          />
        </Cell>
        <RowButton symbol="minus.circle" label={`Remove “${name}”`} onClick={remove} hover />
        {springing && (
          <span
            style={spring.flashing ? { animation: `spring-flash ${SPRING_FLASH}ms linear` } : undefined}
            className="pointer-events-none absolute inset-0 rounded-md bg-blue-500/25"
          />
        )}
        {over && <DropLine />}
        {overEnd && !showFolders && <DropLine below />}
      </div>
      {/* Its folders: drop a property on one to give just that folder a level of its own */}
      {showFolders && (
        <div
          data-level={JSON.stringify(slot)}
          data-drop={JSON.stringify({ kind: "slot", slot: { ...slot, index: slot.index + 1 } })}
          style={{ paddingLeft: indent(chain.length).paddingLeft + 40 }}
          className="relative flex flex-wrap items-center gap-1 pr-2 pt-0.5 pb-1.5"
        >
          <Guides depth={chain.length} />
          {named.length === 0 && !none && <span className="text-[11px] text-neutral-500">No folders yet</span>}
          {[...named.slice(0, FOLDER_CHIPS), ...(none ? [none] : [])].map((v) => {
            const forked = Object.prototype.hasOwnProperty.call(level.branches, v.value);
            const off = v.value === NO_VALUE && loose;
            return (
              <span
                key={v.value}
                data-drop={JSON.stringify({ kind: "fork", slot, value: v.value })}
                title={`${v.label}: ${v.count.toLocaleString()} ${v.count === 1 ? "file" : "files"}`}
                className={`shrink-0 max-w-[140px] truncate px-1.5 h-5 leading-5 rounded-[5px] text-[11px] ${
                  forkOver === v.value
                    ? "bg-blue-600 text-white"
                    : forked
                      ? "bg-blue-500/15 text-blue-400"
                      : off
                        ? "border border-dashed border-neutral-600 text-neutral-500"
                        : "bg-neutral-800 dark:bg-neutral-700/60 text-neutral-300"
                }`}
              >
                {v.label}
              </span>
            );
          })}
          {named.length > FOLDER_CHIPS && (
            <span className="shrink-0 text-[11px] text-neutral-500">+{(named.length - FOLDER_CHIPS).toLocaleString()} more</span>
          )}
          {overEnd && <DropLine below />}
        </div>
      )}
    </>
  );
}

function Cell({ children }: { children?: React.ReactNode }) {
  return <div className="flex justify-center">{children}</div>;
}

/** A level's setting, as a checkbox in its column. */
function Check({ checked, label, onChange }: { checked: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      title={label}
      aria-label={label}
      // Not the start of a drag
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/** Where a dragged level or property would go: a line above the row (or below the last). */
function DropLine({ below = false }: { below?: boolean }) {
  return (
    <span className={`pointer-events-none absolute left-0 right-0 h-0.5 rounded-full bg-blue-500 ${below ? "-bottom-px" : "-top-px"}`} />
  );
}

/** A row's button, shown on hover. */
function RowButton({ symbol, label, onClick, hover = false }: { symbol: string; label: string; onClick: () => void; hover?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Not the start of a drag
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/60 ${
        hover ? "opacity-0 group-hover:opacity-100" : ""
      }`}
    >
      <SymbolIcon name={symbol} size={12} fallback="·" />
    </button>
  );
}
