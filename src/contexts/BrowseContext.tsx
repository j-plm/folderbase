import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFolderSource } from "../components/folders/useFolderSource";
import { useLocationFiles } from "../hooks/useLocationFiles";
import { useRuleRunner } from "../hooks/useRuleRunner";
import { impliedByFile, valueReader } from "../lib/fileValues";
import type { RowGroup } from "../lib/dbGroups";
import {
  folderColumnLabel,
  folderGroups,
  folderTree,
  levelAt,
  enclosingPlace,
  levelsBelow,
  noValuePlacement,
  pinPlace,
  skipSingles,
  placeFilterRules,
  placeFilters,
  placeSteps,
  placeWithin,
  viewFiles,
  type FolderTree,
  type PlaceFilter,
  type PlaceStep,
} from "../lib/folderTree";
import { createPropertyValue } from "../lib/commands";
import { PROP_PREFIX, propName } from "../lib/fileColumns";
import { uniqueViewName, type FolderPin } from "../lib/tableViews";
import type { FileRecord } from "../types";
import { useLocationViews } from "./LocationViewsContext";
import { useNavigation } from "./NavigationContext";
import { setLevel, setSkipSingleEverywhere, skipsSingleEverywhere, slotAt } from "../lib/hierarchy";
import { dateUnitsFor, defaultDateUnit, isDateColumn } from "../lib/dateFolders";
import type { MenuEntry } from "../lib/nativeMenu";

/** A place in one of the location's views, as Back and Forward return to it. */
interface Visit {
  viewId: string;
  path: string[];
}

const TOP: string[] = [];

export interface BrowseValue {
  /** All of the location's files. */
  files: FileRecord[];
  /** The location's name (null while loading). */
  locationName: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** The files the active view's filters let through (null until they can be worked out). */
  shown: FileRecord[] | null;
  /** Those files as the view's folders (null with `shown`). */
  tree: FolderTree | null;
  /** Where you are in the view's folders: a path of folder values ([] is the view's top). */
  place: string[];
  /** Each folder on the way there, named. */
  steps: PlaceStep[];
  /** The place as filter rows ("Person is Josh"), one per folder, each able to move to another folder at its level. */
  filters: PlaceFilter[];
  /** The levels the folders below the place are made of, named ("Year", "Created"). */
  levelNames: string[];
  /**
   * New View from Folder: the folder at `path` as a saved view of its own —
   * its folders on the way as filters, the levels below it as its folders.
   * Null when no filters pick exactly its files.
   */
  viewFromFolder: (path: string[]) => { label: string; create: () => Promise<void> } | null;
  /**
   * New Folder where you are: the level's property (a Text, Select or
   * Multi-select) and its registered values not yet a folder here. Null
   * where the level can't take a typed value, or there's no level.
   */
  newFolderHere: { column: string; label: string; candidates: string[] } | null;
  /** Makes a folder here: registers the value if it's new, then shows its folder here (only here). */
  makeFolder: (value: string) => Promise<void>;
  /** A folder made with New Folder that's still empty: it can be removed. */
  isEmptyMadeFolder: (path: string[]) => boolean;
  removeMadeFolder: (path: string[]) => void;
  /**
   * The settings of the level inside a folder (at `path`; the place itself
   * for empty space), as a submenu for its right-click menu: whether files
   * without a value get a "No X" folder, whether every value shows. Empty
   * where the folder holds only files.
   */
  levelMenu: (path: string[]) => MenuEntry[];
  /** Folders holding just one folder show merged with it, and open and go up past it (a view setting). */
  skipSingle: boolean;
  setSkipSingle: (on: boolean) => void;
  /** Where opening the folder at `path` lands: on past single folders when they're skipped. */
  opens: (path: string[]) => string[];
  /** The New Folder sheet, opened from the toolbar, a menu or ⇧⌘N. */
  newFolderOpen: boolean;
  setNewFolderOpen: (open: boolean) => void;
  /** The folders below the place as the Database view's groups, for these rows (null: only files there). */
  groupsFor: (rows: FileRecord[]) => RowGroup<FileRecord>[] | null;
  go: (path: string[]) => void;
  /** Opens a folder inside the current one. */
  enter: (value: string) => void;
  up: () => void;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
}

const BrowseContext = createContext<BrowseValue | null>(null);

/**
 * Browsing a location through its active view (spec ▸ Views): the view's
 * filters decide which files are in play, its hierarchy lays them out,
 * and the place — remembered per view for the session — is where you are in
 * those folders. Every view mode shows the same place.
 */
export function BrowseProvider({ locationId, children }: { locationId: string; children: ReactNode }) {
  const { definition, active, select, views, create, recordFolders } = useLocationViews();
  const { files, loading, refresh } = useLocationFiles(locationId);
  // The library's rules run over the location's files whenever they load or change
  useRuleRunner(locationId, files, refresh);

  const { locationName, typeOf, scopes, loaded, reload, valuesOf, propertyIdOf } = useFolderSource(locationId);
  // The files reload after edits, which can add properties or scopes the filters and folders read
  useEffect(() => {
    reload().catch(() => {});
  }, [files, reload]);
  const reader = useMemo(
    () => valueReader({ typeOf, scopes, implied: impliedByFile(files, scopes, (p) => typeOf(p) === "array") }),
    [files, typeOf, scopes]
  );

  const table = definition?.table;
  const root = definition?.folders?.root ?? null;
  // Null until the properties the filters and folders read have loaded, so the whole list never flashes first
  const shown = useMemo(() => {
    if (!table) return null;
    if (table.filters.length === 0 && !root) return files;
    if (!loaded) return null;
    return viewFiles(files, table.filters, table.match, reader);
  }, [files, table, root, loaded, reader]);
  const pins = definition?.folders?.pins;
  // Empty folders: every registered value at levels that show them all, and those made with New Folder
  const extras = useMemo(
    () => ({ pins: pins ?? [], registered: (column: string) => (column.startsWith(PROP_PREFIX) ? valuesOf(propName(column)) : []) }),
    [pins, valuesOf]
  );
  const tree = useMemo(
    () => (shown ? folderTree(shown, root, reader, typeOf, folderColumnLabel, extras) : null),
    [shown, root, reader, typeOf, extras]
  );

  const viewFromFolder = useCallback(
    (path: string[]) => {
      if (!table || !tree || path.length === 0) return null;
      // The view's filters must all hold, with the folder's added
      if (table.match === "any" && table.filters.length > 1) return null;
      const rules = placeFilterRules(root, path, reader);
      if (!rules) return null;
      const filters = [...table.filters, ...rules];
      const expected = new Set(tree.filesAt(path).map((f) => f.file_id));
      const picked = viewFiles(files, filters, "all", reader);
      if (picked.length !== expected.size || picked.some((f) => !expected.has(f.file_id))) return null;
      const label = placeSteps(tree, path)[path.length - 1]?.label ?? "Folder";
      const name = uniqueViewName(label, views.map((v) => v.name));
      // Folders made inside it come along, now from the new view's top
      const at = pinPlace(root, path);
      const within = (pins ?? []).filter((p) => at.every((s, i) => p.at[i]?.column === s.column && p.at[i]?.value === s.value));
      const def = {
        table: { ...table, filters, match: "all" as const },
        folders: { root: levelAt(root, path), pins: within.map((p) => ({ ...p, at: p.at.slice(at.length) })) },
      };
      return { label, create: () => create(name, def) };
    },
    [table, tree, root, pins, reader, files, views, create]
  );

  // ── Place and history ──────────────────────────────────────────────────

  const viewId = active?.view_id ?? null;
  /** Each view's place, for this session. */
  const [places, setPlaces] = useState<ReadonlyMap<string, string[]>>(() => new Map());
  const [history, setHistory] = useState<{ visits: Visit[]; index: number }>({ visits: [], index: -1 });
  const historyRef = useRef(history);
  historyRef.current = history;

  // Back and Forward are per location
  useEffect(() => setHistory({ visits: [], index: -1 }), [locationId]);

  const stored = (viewId && places.get(viewId)) || TOP;
  // A folder renamed away or refiled empty: show the deepest one left
  const place = useMemo(() => (tree ? placeWithin(tree, stored) : stored), [tree, stored]);
  const steps = useMemo(() => (tree ? placeSteps(tree, place) : []), [tree, place]);
  const filters = useMemo(() => (tree ? placeFilters(tree, root, place, reader.kindOf) : []), [tree, root, place, reader]);
  const levelNames = useMemo(() => levelsBelow(root, place).map((l) => folderColumnLabel(l.column)), [root, place]);
  // Laid out from the rows the table shows (searched, filtered, sorted, with edits in), not the view's files
  const groupsFor = useCallback(
    (rows: FileRecord[]) => folderGroups(folderTree(rows, root, reader, typeOf, folderColumnLabel), place),
    [root, reader, typeOf, place]
  );

  // ── A level's settings, from a folder's menu ──────────────────────────────

  const { setEditHierarchy } = useNavigation();
  const levelMenu = useCallback(
    (path: string[]): MenuEntry[] => {
      const slot = slotAt(root, path);
      const level = levelAt(root, path);
      if (!slot || !level || !definition) return [];
      const label = folderColumnLabel(level.column);
      const set = (patch: Parameters<typeof setLevel>[2]) =>
        recordFolders({ ...definition.folders, root: setLevel(root, slot, patch) });
      const listed = level.column.startsWith(PROP_PREFIX) && ["enum", "array"].includes(typeOf(propName(level.column)));
      const unit = level.dateUnit ?? defaultDateUnit(level.column);
      const byUnit: MenuEntry[] = isDateColumn(level.column, typeOf)
        ? [
            { type: "separator" },
            ...dateUnitsFor(level.column).map(
              (u): MenuEntry => ({
                type: "check",
                text: `By ${u.label}`,
                checked: u.unit === unit,
                action: () => set({ dateUnit: u.unit === defaultDateUnit(level.column) ? undefined : u.unit }),
              })
            ),
          ]
        : [];
      return [
        {
          type: "submenu",
          text: `${label} Folders`,
          items: [
            {
              type: "check",
              text: `Show “No ${label}” Folder`,
              checked: noValuePlacement(level, reader) === "folder",
              action: () => {
                const next = noValuePlacement(level, reader) === "folder" ? "loose" : "folder";
                set({ noValue: next === noValuePlacement({ column: level.column }, reader) ? undefined : next });
              },
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
            ...byUnit,
            { type: "separator" },
            { type: "item", text: "Edit Hierarchy…", action: () => setEditHierarchy(true) },
          ],
        },
      ];
    },
    [root, definition, recordFolders, typeOf, reader, setEditHierarchy]
  );

  // ── New Folder ─────────────────────────────────────────────────────────

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const levelHere = tree?.contents(place).level ?? null;
  const newFolderHere = useMemo(() => {
    if (!tree || !levelHere || !levelHere.column.startsWith(PROP_PREFIX)) return null;
    const name = propName(levelHere.column);
    if (!["free_text", "enum", "array"].includes(typeOf(name))) return null;
    const here = new Set(tree.contents(place).folders.map((f) => f.value.toLowerCase()));
    return {
      column: levelHere.column,
      label: folderColumnLabel(levelHere.column),
      candidates: valuesOf(name).filter((v) => !here.has(v.toLowerCase())),
    };
  }, [tree, levelHere, place, typeOf, valuesOf]);

  const setPins = useCallback(
    (next: FolderPin[]) => {
      if (definition) recordFolders({ ...definition.folders, root, pins: next });
    },
    [definition, root, recordFolders]
  );

  const makeFolder = useCallback(
    async (text: string) => {
      const value = text.trim();
      if (!newFolderHere || !value) return;
      const name = propName(newFolderHere.column);
      const type = typeOf(name);
      // A value of that name already, in any case: its own spelling
      const registered = valuesOf(name).find((v) => v.toLowerCase() === value.toLowerCase());
      const id = propertyIdOf(name);
      if ((type === "enum" || type === "array") && !registered && id) {
        await createPropertyValue(id, value);
        await reload();
      }
      const folder = registered ?? value;
      if (tree?.contents(place).folders.some((f) => f.value === folder)) return;
      setPins([...(pins ?? []), { at: pinPlace(root, place), column: newFolderHere.column, value: folder }]);
    },
    [newFolderHere, typeOf, valuesOf, propertyIdOf, reload, tree, place, pins, root, setPins]
  );

  /** The pin a folder was made with, if it was. */
  const pinOf = useCallback(
    (path: string[]) => {
      const parent = path.slice(0, -1);
      const column = levelAt(root, parent)?.column;
      const at = JSON.stringify(pinPlace(root, parent));
      return (pins ?? []).find((p) => p.column === column && p.value === path[path.length - 1] && JSON.stringify(p.at) === at);
    },
    [root, pins]
  );
  const isEmptyMadeFolder = useCallback(
    (path: string[]) => !!pinOf(path) && tree?.filesAt(path).length === 0,
    [pinOf, tree]
  );
  const removeMadeFolder = useCallback(
    (path: string[]) => {
      const pin = pinOf(path);
      if (pin) setPins((pins ?? []).filter((p) => p !== pin));
    },
    [pinOf, pins, setPins]
  );

  const setPlace = useCallback((view: string, path: string[]) => {
    setPlaces((prev) => new Map(prev).set(view, path));
  }, []);

  const visit = useCallback((v: Visit) => {
    setHistory((h) => {
      const current = h.visits[h.index];
      if (current && current.viewId === v.viewId && JSON.stringify(current.path) === JSON.stringify(v.path)) return h;
      return { visits: [...h.visits.slice(0, h.index + 1), v], index: h.index + 1 };
    });
  }, []);

  // Choosing a view (from the toolbar or the sidebar) is a step Back can return from
  const placesRef = useRef(places);
  placesRef.current = places;
  useEffect(() => {
    if (!viewId) return;
    const current = historyRef.current.visits[historyRef.current.index];
    if (current?.viewId !== viewId) visit({ viewId, path: placesRef.current.get(viewId) ?? TOP });
  }, [viewId, visit]);

  const go = useCallback(
    (path: string[]) => {
      if (!viewId) return;
      setPlace(viewId, path);
      visit({ viewId, path });
    },
    [viewId, setPlace, visit]
  );
  // Single folders are skipped level by level: a folder is if its own level says so
  const skipSingle = skipsSingleEverywhere(root);
  const setSkipSingle = useCallback(
    (on: boolean) => {
      if (definition) recordFolders({ ...definition.folders, root: setSkipSingleEverywhere(root, on) });
    },
    [definition, root, recordFolders]
  );
  const skips = useCallback((folder: string[]) => !!levelAt(root, folder.slice(0, -1))?.skipSingle, [root]);
  const opens = useCallback((path: string[]) => (tree ? skipSingles(tree, path, skips) : path), [tree, skips]);
  const enter = useCallback((value: string) => go(opens([...place, value])), [go, opens, place]);
  const up = useCallback(() => {
    if (place.length > 0) go(tree ? enclosingPlace(tree, place, skips) : place.slice(0, -1));
  }, [go, place, tree, skips]);

  const travel = useCallback(
    (by: number) => {
      const h = historyRef.current;
      const target = h.visits[h.index + by];
      if (!target) return;
      setHistory({ ...h, index: h.index + by });
      setPlace(target.viewId, target.path);
      if (target.viewId !== viewId) void select(target.viewId);
    },
    [viewId, select, setPlace]
  );
  const back = useCallback(() => travel(-1), [travel]);
  const forward = useCallback(() => travel(1), [travel]);

  // Finder's Go menu keys: ⌘[ Back, ⌘] Forward, ⌘↑ Enclosing Folder
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      // ⇧⌘N: New Folder, as in Finder
      if (e.shiftKey) {
        if (e.key.toLowerCase() !== "n" || !newFolderHere) return;
        e.preventDefault();
        setNewFolderOpen(true);
        return;
      }
      if (e.key === "[") back();
      else if (e.key === "]") forward();
      else if (e.key === "ArrowUp") up();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [back, forward, up, newFolderHere]);

  const value = useMemo<BrowseValue>(
    () => ({
      files,
      locationName,
      loading,
      refresh,
      shown,
      tree,
      place,
      steps,
      filters,
      levelNames,
      viewFromFolder,
      newFolderHere,
      makeFolder,
      isEmptyMadeFolder,
      removeMadeFolder,
      newFolderOpen,
      setNewFolderOpen,
      levelMenu,
      skipSingle,
      setSkipSingle,
      opens,
      groupsFor,
      go,
      enter,
      up,
      back,
      forward,
      canBack: history.index > 0,
      canForward: history.index < history.visits.length - 1,
    }),
    [files, locationName, loading, refresh, shown, tree, place, steps, filters, levelNames, viewFromFolder, newFolderHere, makeFolder, isEmptyMadeFolder, removeMadeFolder, newFolderOpen, levelMenu, skipSingle, setSkipSingle, opens, groupsFor, go, enter, up, back, forward, history]
  );
  return <BrowseContext.Provider value={value}>{children}</BrowseContext.Provider>;
}

/** Browsing the active location, or null when no location is showing. */
export function useBrowse(): BrowseValue | null {
  return useContext(BrowseContext);
}
