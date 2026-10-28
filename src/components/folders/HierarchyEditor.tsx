import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { createProperty } from "../../lib/commands";
import { PROP_PREFIX } from "../../lib/fileColumns";
import { impliedByFile, valueReader } from "../../lib/fileValues";
import { SymbolIcon } from "../../lib/fileIcons";
import {
  forkAt,
  insertLevel,
  moveIntoFork,
  moveLevel,
  chainAt,
  removeFork,
  removeLevel,
  type LevelSlot,
  setEveryLevel,
  settingAcross,
} from "../../lib/hierarchy";
import { FOLDER_NATIVE_COLUMNS, defaultDirection, folderColumnLabel, noValuePlacement, seedFromGroups, viewFiles } from "../../lib/folderTree";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import { EXTRACTED_KEYS, propertyLabel } from "../../lib/propertyTypes";
import type { FolderLevel, ViewDefinition } from "../../lib/tableViews";
import type { FileRecord } from "../../types";
import Dialog, { DialogButton, DialogField, dialogTextField } from "../shared/Dialog";
import HierarchyLevels, { LEVEL_GRID, SPRING_FLASH, isListed, type DragItem, type DropMark, type DropTarget } from "./HierarchyLevels";
import PropertyPalette from "./PropertyPalette";
import { useFolderSource } from "./useFolderSource";

interface Props {
  locationId: string;
  files: FileRecord[];
  definition: ViewDefinition;
  onChange: (root: FolderLevel | null) => void;
}

/** Pointer travel before a press becomes a drag (a click below this). */
const DRAG_THRESHOLD = 4;

/** How long a drag rests on a level before it opens its folders to drop onto. */
const SPRING_DELAY = 1000;

/** The share of a row's height at its top and bottom that drops between rows; its middle is the level itself. */
const ROW_EDGE = 0.3;

/** Where on a row a point is: its top edge, its middle, or its bottom edge. */
function rowZone(el: HTMLElement, y: number): "above" | "middle" | "below" {
  const rect = el.getBoundingClientRect();
  const at = (y - rect.top) / rect.height;
  return at < ROW_EDGE ? "above" : at > 1 - ROW_EDGE ? "below" : "middle";
}

/** Where a drag over the point would land, from the drop target under it: a row's edges are between rows, its middle nowhere. */
function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
  if (!el?.dataset.drop) return null;
  const mark = JSON.parse(el.dataset.drop) as DropMark;
  if (mark.kind !== "row") return mark;
  const zone = rowZone(el, y);
  if (zone === "middle") return null;
  return { kind: "slot", slot: { ...mark.slot, index: mark.slot.index + (zone === "below" ? 1 : 0) } };
}

/** The level under the point, to spring open: a row's middle (not its edges, which drop between rows), or the folders shown under it. */
function levelAt(x: number, y: number): LevelSlot | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-level]");
  if (!el?.dataset.level) return null;
  const isRow = el.dataset.drop && (JSON.parse(el.dataset.drop) as DropMark).kind === "row";
  return isRow && rowZone(el, y) !== "middle" ? null : (JSON.parse(el.dataset.level) as LevelSlot);
}

/**
 * The view's hierarchy of properties (spec ▸ Hierarchy of a view): an
 * outline of the levels in order, each level's settings as checkboxes under
 * labelled headers, and branches as folder rows with their own levels under
 * them. Drag a property from the list into place (or add it with +), drag
 * levels to reorder them, or drop a property onto one of a level's folders
 * to give just that folder a level of its own. Changes show at once in the
 * view behind.
 */
export default function HierarchyEditor({ locationId, files, definition, onChange }: Props) {
  const { library, typeOf, scopes, properties, reload } = useFolderSource(locationId);
  const [drag, setDrag] = useState<{ item: DragItem; x: number; y: number; target: DropTarget | null } | null>(null);
  // Spring-loading: the level a drag has rested on opens its folders, as Finder opens a folder held over
  const [sprung, setSprung] = useState<LevelSlot | null>(null);
  // The level it's resting on before then, blue, and blinking just before it opens
  const [spring, setSpring] = useState<{ level: LevelSlot; flashing: boolean } | null>(null);
  const sprungRef = useRef<LevelSlot | null>(null);
  const resting = useRef<{ level: string | null; timers: ReturnType<typeof setTimeout>[] }>({ level: null, timers: [] });
  const [naming, setNaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<LevelSlot | null>(null);
  const root = definition.folders?.root ?? null;
  // A level removed or moved since it was picked is no longer selected
  const selected = picked && chainAt(root, picked.chain)[picked.index] ? picked : null;
  const { table } = definition;
  // Read when a drag ends, which may come from a handler bound before the last change
  const rootRef = useRef(root);
  // Focused when a level is picked (a press there starts a drag, which keeps focus away), so Delete removes it
  const listRef = useRef<HTMLDivElement>(null);
  const pick = (slot: LevelSlot | null) => {
    setPicked(slot);
    listRef.current?.focus({ preventScroll: true });
  };
  rootRef.current = root;

  const reader = useMemo(
    () => valueReader({ typeOf, scopes, implied: impliedByFile(files, scopes, (p) => typeOf(p) === "array") }),
    [files, scopes, typeOf]
  );
  // The view's own files: its filters, as the Database view applies them
  const shown = useMemo(() => viewFiles(files, table.filters, table.match, reader), [files, table.filters, table.match, reader]);
  const direction = (column: string) => defaultDirection(column, typeOf);
  const lastSlot = (r: FolderLevel | null): LevelSlot => ({ chain: [], index: chainAt(r, []).length });

  function drop(item: DragItem, target: DropTarget) {
    const current = rootRef.current;
    if (item.kind === "property") {
      onChange(
        target.kind === "slot"
          ? insertLevel(current, target.slot, item.column, direction(item.column))
          : forkAt(current, target.slot, target.value, item.column, direction(item.column))
      );
    } else {
      onChange(target.kind === "slot" ? moveLevel(current, item.slot, target.slot) : moveIntoFork(current, item.slot, target.slot, target.value));
    }
  }

  /** The level a drag is over now: opened once it stays there; an open one stays open until another opens. */
  function rest(level: LevelSlot | null) {
    const key = level && JSON.stringify(level);
    if (key === resting.current.level) return;
    resting.current.timers.forEach(clearTimeout);
    resting.current = { level: key, timers: [] };
    // The open one, or none: nothing to wait for
    if (!level || key === JSON.stringify(sprungRef.current)) {
      setSpring(null);
      return;
    }
    setSpring({ level, flashing: false });
    resting.current.timers = [
      setTimeout(() => setSpring({ level, flashing: true }), SPRING_DELAY - SPRING_FLASH),
      setTimeout(() => {
        sprungRef.current = level;
        setSprung(level);
        setSpring(null);
      }, SPRING_DELAY),
    ];
  }

  // Mouse events rather than pointer events: after a native menu closes WebKit can skip the next pointerdown
  function startDrag(e: React.MouseEvent, item: DragItem) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    const finish = () => {
      rest(null);
      sprungRef.current = null;
      setSprung(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      document.body.style.cursor = "";
      setDrag(null);
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      document.body.style.cursor = "grabbing";
      setDrag({ item, x: ev.clientX, y: ev.clientY, target: targetAt(ev.clientX, ev.clientY) });
      rest(levelAt(ev.clientX, ev.clientY));
    };
    const onUp = (ev: MouseEvent) => {
      const target = dragging ? targetAt(ev.clientX, ev.clientY) : null;
      finish();
      if (target) drop(item, target);
    };
    // Escape puts it back where it came from
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
  }
  useEffect(
    () => () => {
      document.body.style.cursor = "";
      resting.current.timers.forEach(clearTimeout);
    },
    []
  );

  async function createLevelProperty() {
    const name = (naming ?? "").trim();
    setNaming(null);
    if (!name) return;
    try {
      // An existing property of that name is used as it is
      const existing = properties.find((p) => p.toLowerCase() === name.toLowerCase());
      if (!existing) {
        await createProperty(name, library, "enum");
        await reload();
      }
      const column = PROP_PREFIX + (existing ?? name);
      onChange(insertLevel(rootRef.current, lastSlot(rootRef.current), column, direction(column)));
    } catch (e) {
      setError(String(e));
    }
  }

  /** Where + adds: just after the selected level, else at the end. */
  const addSlot = (): LevelSlot => (selected ? { ...selected, index: selected.index + 1 } : lastSlot(root));

  function addMenu(e: React.MouseEvent) {
    const entry = (column: string, label: string): MenuEntry => ({
      type: "item",
      text: label,
      action: () => {
        onChange(insertLevel(rootRef.current, addSlot(), column, direction(column)));
        setPicked(addSlot());
      },
    });
    const custom = properties.filter((p) => !EXTRACTED_KEYS.has(p));
    const conditional = custom.filter((p) => scopes.some((s) => s.property === p && s.conditions.length > 0));
    const own = custom.filter((p) => !conditional.includes(p));
    const media = properties.filter((p) => EXTRACTED_KEYS.has(p));
    const section = (title: string, entries: MenuEntry[]): MenuEntry[] =>
      entries.length ? [{ type: "header", text: title }, ...entries, { type: "separator" }] : [];
    showContextMenu(
      [
        ...section("Custom", own.map((p) => entry(PROP_PREFIX + p, propertyLabel(p)))),
        ...section("Conditional", conditional.map((p) => entry(PROP_PREFIX + p, propertyLabel(p)))),
        ...section("Native", FOLDER_NATIVE_COLUMNS.map((c) => entry(c.id, c.label))),
        ...section("Media", media.map((p) => entry(PROP_PREFIX + p, propertyLabel(p)))),
        { type: "item", text: "New Property…", action: () => setNaming("") },
      ],
      { event: e }
    );
  }

  function removeSelected() {
    if (!selected) return;
    const { chain, index } = selected;
    const inside = chain[chain.length - 1];
    // A branch's only level goes with its branch, as the row's own remove does
    const only = inside && chainAt(root, chain).length === 1;
    onChange(only ? removeFork(root, { chain: chain.slice(0, -1), index: inside.index }, inside.value) : removeLevel(root, { chain, index }));
    setPicked(null);
  }

  const sectionHeading = "px-3 pt-3 pb-1 text-[11px] font-semibold text-neutral-500";
  const columnHeading = "text-center text-[10px] leading-tight text-neutral-500";
  // Each setting across every level, for the All levels row: ticked, empty, or mixed
  const everyLevel = () => true;
  const listed = (l: FolderLevel) => isListed(l.column, typeOf);
  const inFolder = (l: FolderLevel) => noValuePlacement(l, reader) === "folder";
  const across = {
    allValues: settingAcross(root, listed, (l) => !!l.allValues),
    skipSingle: settingAcross(root, everyLevel, (l) => !!l.skipSingle),
    noValue: settingAcross(root, everyLevel, inFolder),
  };
  const barButton =
    "w-7 h-6 flex items-center justify-center text-neutral-300 hover:bg-neutral-700/60 disabled:text-neutral-600 disabled:hover:bg-transparent";

  return (
    <div className="flex flex-col h-full">
      {error && <div className="shrink-0 px-3 py-2 text-xs text-red-500">{error}</div>}

      <div
        ref={listRef}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape" && selected) setPicked(null);
          if ((e.key === "Backspace" || e.key === "Delete") && selected && !(e.target instanceof HTMLInputElement)) {
            e.preventDefault();
            removeSelected();
          }
        }}
        className="flex-1 min-h-0 overflow-y-auto pb-3 outline-none"
      >
        <div className="px-3 pt-3">
          {/* The levels' column headers: what each checkbox under them means */}
          <div className={`${LEVEL_GRID} pb-1 pr-1`}>
            <span className="text-[11px] font-semibold text-neutral-500">Levels</span>
            {root ? (
              <>
                <span className={columnHeading}>Order</span>
                <span className={columnHeading} title="Every value shows as a folder, even with no files yet (Select and Multi-select)">
                  All
                  <br />
                  Values
                </span>
                <span
                  className={columnHeading}
                  title="A folder holding just one folder, and no files, shows merged with it (“2024 › Tax”) and opens straight through"
                >
                  Skip
                  <br />
                  Singles
                </span>
                <span className={columnHeading} title="Files without a value go in a “No …” folder; off, they sit loose in the parent folder">
                  “No …”
                  <br />
                  Folder
                </span>
                <span />
              </>
            ) : (
              table.groups.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange(seedFromGroups(table.groups))}
                  className="col-span-5 justify-self-end px-2 py-0.5 text-xs rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
                >
                  Use Database Groups
                </button>
              )
            )}
          </div>
          {/* Anywhere in the box no row claims (its edges, the bar) takes a drop at the end */}
          <div
            data-drop={root ? JSON.stringify({ kind: "slot", slot: lastSlot(root) }) : undefined}
            className="rounded-lg border border-neutral-700/60 bg-neutral-950/30 dark:bg-white/[0.02] overflow-hidden"
          >
            {root && (
              // Each setting for every level at once
              <div className={`${LEVEL_GRID} h-7 pr-1 border-b border-neutral-700/40`}>
                <span className="pl-2 text-[12px] text-neutral-400">All levels</span>
                <span />
                <AcrossCheck
                  state={across.allValues}
                  label="Show all values at every Select and Multi-select level"
                  onChange={(on) => onChange(setEveryLevel(root, (l) => (listed(l) ? { allValues: on ? true : undefined } : null)))}
                />
                <AcrossCheck
                  state={across.skipSingle}
                  label="Skip single folders at every level"
                  onChange={(on) => onChange(setEveryLevel(root, () => ({ skipSingle: on ? true : undefined })))}
                />
                <AcrossCheck
                  state={across.noValue}
                  label="A “No …” folder at every level"
                  onChange={(on) =>
                    onChange(
                      setEveryLevel(root, (l) => {
                        const where = on ? "folder" : "loose";
                        // Leaving out each level's own default, as a single level does
                        return { noValue: where === noValuePlacement({ column: l.column }, reader) ? undefined : where };
                      })
                    )
                  }
                />
                <span />
              </div>
            )}
            <div className="p-1">
              <HierarchyLevels
                root={root}
                files={shown}
                reader={reader}
                typeOf={typeOf}
                target={drag?.target ?? null}
                dragging={drag?.item ?? null}
                hovered={drag ? sprung : null}
                spring={drag ? spring : null}
                selected={selected}
                onSelect={pick}
                onStartDrag={startDrag}
                onChange={onChange}
              />
            </div>
            {/* Add and remove, as under a list in System Settings */}
            <div className="flex items-center border-t border-neutral-700/60">
              <button type="button" title="Add a Level" aria-label="Add a Level" onClick={addMenu} className={barButton}>
                <SymbolIcon name="plus" size={11} fallback="+" />
              </button>
              <span className="w-px h-4 bg-neutral-700/60" />
              <button
                type="button"
                title={selected ? `Remove “${folderColumnLabel(chainAt(root, selected.chain)[selected.index].column)}”` : "Remove the Selected Level"}
                aria-label="Remove the Selected Level"
                disabled={!selected}
                onClick={removeSelected}
                className={barButton}
              >
                <SymbolIcon name="minus" size={11} fallback="–" />
              </button>
            </div>
          </div>
        </div>
        <p className={`${sectionHeading} mt-3`}>Properties</p>
        <div className="px-1">
          <PropertyPalette
            root={root}
            properties={properties}
            files={shown}
            reader={reader}
            typeOf={typeOf}
            scopes={scopes}
            onStartDrag={startDrag}
            onAdd={(column) => onChange(insertLevel(root, lastSlot(root), column, direction(column)))}
            onFork={(slot, value, column) => onChange(forkAt(root, slot, value, column, direction(column)))}
            onNewProperty={() => setNaming("")}
          />
        </div>
      </div>

      {drag && (
        <div
          style={{ left: drag.x + 12, top: drag.y + 6 }}
          className="fixed z-[60] pointer-events-none px-2 py-0.5 rounded-md bg-neutral-700 text-neutral-100 text-xs shadow-lg"
        >
          {drag.item.label}
        </div>
      )}

      {naming !== null && (
        <Dialog
          title="New Property"
          message="It's added as the last level. Its values become the folders; files get them from the Database view."
          onCancel={() => setNaming(null)}
          onSubmit={() => void createLevelProperty()}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setNaming(null)}>Cancel</DialogButton>
              <DialogButton variant="default" disabled={!naming.trim()}>
                Create
              </DialogButton>
            </>
          }
        >
          <DialogField label="Name:">
            <input
              autoFocus
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              spellCheck={false}
              className={dialogTextField}
            />
          </DialogField>
        </Dialog>
      )}
    </div>
  );
}

/** A setting for every level: ticked when all have it, empty when none, a dash when some (clicking a dash ticks all). */
function AcrossCheck({ state, label, onChange }: { state: "on" | "off" | "mixed" | null; label: string; onChange: (on: boolean) => void }) {
  if (state === null) return <span />;
  return (
    <div className="flex justify-center">
      <input
        type="checkbox"
        title={label}
        aria-label={label}
        aria-checked={state === "mixed" ? "mixed" : state === "on"}
        ref={(el) => {
          if (el) el.indeterminate = state === "mixed";
        }}
        checked={state === "on"}
        onChange={() => onChange(state !== "on")}
      />
    </div>
  );
}
