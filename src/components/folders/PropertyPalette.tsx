import { useMemo, useState } from "react";
import type React from "react";
import { SymbolIcon } from "../../lib/fileIcons";
import type { ValueReader } from "../../lib/fileValues";
import { levelExamples, scopeSuggestion, type LevelSlot } from "../../lib/hierarchy";
import { FOLDER_NATIVE_COLUMNS, folderColumnLabel } from "../../lib/folderTree";
import { PROP_PREFIX } from "../../lib/fileColumns";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import { EXTRACTED_KEYS, propertyLabel } from "../../lib/propertyTypes";
import type { Scope } from "../../lib/scopes";
import type { FolderLevel } from "../../lib/tableViews";
import type { FileRecord, ValueType } from "../../types";
import { popoverField } from "../shared/Popover";
import { columnSymbol, type DragItem } from "./HierarchyLevels";

interface Props {
  root: FolderLevel | null;
  /** Custom properties, by name. */
  properties: string[];
  files: FileRecord[];
  reader: ValueReader;
  typeOf: (name: string) => ValueType;
  scopes: Scope[];
  onStartDrag: (e: React.MouseEvent, item: DragItem) => void;
  /** Adds a column as the last level. */
  onAdd: (column: string) => void;
  /** Adds a column just inside one folder of a level (a scoped property's natural place). */
  onFork: (slot: LevelSlot, value: string, column: string) => void;
  onNewProperty: () => void;
}

/** Every column used as a level anywhere in the structure. */
function usedColumns(root: FolderLevel | null, into = new Set<string>()): Set<string> {
  for (let level = root; level; level = level.next) {
    into.add(level.column);
    for (const fork of Object.values(level.branches)) usedColumns(fork, into);
  }
  return into;
}

interface Pill {
  column: string;
  label: string;
  /** Where a conditional property applies. */
  scope?: Scope;
}

/**
 * The properties a level can be made of, as pills in groups: the library's
 * own, those that apply only inside another property's value, the file's
 * own columns, and the media's (read from the file). Drag one into the
 * levels, double-click to add it, or right-click for where. Hovering one
 * shows the folders it would make.
 */
export default function PropertyPalette({
  root,
  properties,
  files,
  reader,
  typeOf,
  scopes,
  onStartDrag,
  onAdd,
  onFork,
  onNewProperty,
}: Props) {
  const [search, setSearch] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const used = useMemo(() => usedColumns(root), [root]);
  const q = search.trim().toLowerCase();
  const matches = (p: Pill) => !q || p.label.toLowerCase().includes(q);

  const groups = useMemo(() => {
    const own: Pill[] = [];
    const conditional: Pill[] = [];
    const camera: Pill[] = [];
    for (const name of properties) {
      const pill: Pill = { column: PROP_PREFIX + name, label: propertyLabel(name) };
      const scope = scopes.find((s) => s.property === name && s.conditions.length > 0);
      if (EXTRACTED_KEYS.has(name)) camera.push(pill);
      else if (scope) conditional.push({ ...pill, scope });
      else own.push(pill);
    }
    const native: Pill[] = FOLDER_NATIVE_COLUMNS.map((c) => ({ column: c.id, label: c.label }));
    // As everywhere properties are listed: Custom (conditional ones apart, after), Native, then Media
    return [
      { title: "Custom", pills: own, newProperty: true },
      { title: "Conditional", pills: conditional, newProperty: false },
      { title: "Native", pills: native, newProperty: false },
      { title: "Media", pills: camera, newProperty: false },
    ];
  }, [properties, scopes]);

  // Worked out for the one hovered, not for every pill on every change
  const hoveredPill = hovered ? groups.flatMap((g) => g.pills).find((p) => p.column === hovered) : undefined;
  const hoveredExamples = useMemo(() => {
    if (!hovered) return "";
    const ex = levelExamples(files, { column: hovered, direction: "asc" }, reader, typeOf, `No ${folderColumnLabel(hovered)}`, 4);
    return ex.values.map((v) => v.label).join(" · ") + (ex.more > 0 ? ` +${ex.more}` : "");
  }, [hovered, files, reader, typeOf]);

  /** Where a conditional property naturally goes: inside its condition's folder, when that's a level. */
  function naturalPlace(pill: Pill): { slot: LevelSlot; value: string } | null {
    const suggestion = pill.scope ? scopeSuggestion(root, pill.scope) : null;
    if (!suggestion || !pill.scope) return null;
    // The scope names its value as it was written; the folder is the files' own spelling
    const column = `${PROP_PREFIX}${pill.scope.conditions[0].property}`;
    const folders = levelExamples(files, { column, direction: "asc" }, reader, typeOf, "", Infinity).values;
    const value = folders.find((v) => v.value.toLowerCase() === suggestion.value.toLowerCase())?.value ?? suggestion.value;
    return { slot: suggestion.slot, value };
  }

  /** Double-click: where it naturally goes, else as the last level. */
  function add(pill: Pill) {
    const natural = naturalPlace(pill);
    if (natural) onFork(natural.slot, natural.value, pill.column);
    else onAdd(pill.column);
  }

  function menu(e: React.MouseEvent, pill: Pill) {
    e.preventDefault();
    const natural = naturalPlace(pill);
    const entries: MenuEntry[] = [
      ...(natural
        ? [{ type: "item" as const, text: `Add Under “${natural.value}”`, action: () => onFork(natural.slot, natural.value, pill.column) }]
        : []),
      { type: "item", text: "Add as Last Level", action: () => onAdd(pill.column) },
    ];
    showContextMenu(entries, { event: e });
  }

  const condition = (scope: Scope) =>
    `Only where ${scope.conditions.map((c) => `${propertyLabel(c.property)} has “${c.value}”`).join(" or ")}`;

  return (
    <div className="flex flex-col gap-2 px-2">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search properties"
        spellCheck={false}
        className={`${popoverField} w-full`}
      />
      {groups.map((group) => {
        const pills = group.pills.filter(matches);
        if (pills.length === 0 && !(group.newProperty && !q)) return null;
        return (
          <div key={group.title} className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold text-neutral-500">{group.title}</p>
            <div className="flex flex-wrap gap-1">
              {pills.map((pill) => {
                const isUsed = used.has(pill.column);
                return (
                  <span
                    key={pill.column}
                    onMouseDown={(e) => onStartDrag(e, { kind: "property", column: pill.column, label: pill.label })}
                    onDoubleClick={() => add(pill)}
                    onContextMenu={(e) => menu(e, pill)}
                    onMouseEnter={() => setHovered(pill.column)}
                    onMouseLeave={() => setHovered((h) => (h === pill.column ? null : h))}
                    title={pill.scope ? condition(pill.scope) : undefined}
                    className={`flex items-center gap-1 h-[22px] max-w-full px-2 rounded-full border text-[12px] cursor-grab select-none ${
                      isUsed
                        ? "border-neutral-700 text-neutral-400"
                        : "border-neutral-600 bg-neutral-800 dark:bg-neutral-700/50 text-neutral-100 hover:border-neutral-500"
                    }`}
                  >
                    <SymbolIcon name={columnSymbol(pill.column, typeOf)} size={11} fallback="•" className="shrink-0 text-neutral-400" />
                    <span className="truncate">{pill.label}</span>
                    {isUsed && <SymbolIcon name="checkmark" size={9} fallback="✓" className="shrink-0 text-neutral-500" />}
                  </span>
                );
              })}
              {group.newProperty && !q && (
                <button
                  type="button"
                  onClick={onNewProperty}
                  className="flex items-center gap-1 h-[22px] px-2 rounded-full border border-dashed border-neutral-600 text-[12px] text-blue-400 hover:border-neutral-500"
                >
                  <SymbolIcon name="plus" size={10} fallback="+" />
                  New Property…
                </button>
              )}
            </div>
          </div>
        );
      })}
      {/* The hovered property's folders, and where it applies */}
      <div className="min-h-[30px] text-[11px] text-neutral-500">
        {hoveredPill ? (
          <>
            <p className="truncate">
              <span className="text-neutral-300">{hoveredPill.label}</span>
              {hoveredExamples ? `: ${hoveredExamples}` : ": no values yet"}
            </p>
            {hoveredPill.scope && <p className="truncate">{condition(hoveredPill.scope)}</p>}
          </>
        ) : (
          <p>Drag a property into the levels, or double-click to add it.</p>
        )}
      </div>
    </div>
  );
}
