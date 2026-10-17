import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import {
  clearFolderLabels,
  countMappingConflicts,
  createProperty,
  createPropertyValue,
  foldersNamed,
  deletePropertyValue,
  deleteProperty,
  getLocationProperties,
  getLocations,
  getMappingNodes,
  getProperties,
  getPropertyValues,
  renameProperty,
  movePropertyValue,
  renamePropertyValue,
  setEditMenuLabels,
  setFolderLabels,
  setMetadataCells,
  type CellEdit,
  updatePropertyType,
} from "../../lib/commands";
import type { FileRecord, Property, PropertyConfig, PropertyValue, ValueType } from "../../types";
import { FileIcon, SymbolIcon } from "../../lib/fileIcons";
import { useNavigation } from "../../contexts/NavigationContext";
import { KIND_CATEGORIES, dateGroup, formatFinderDate, formatFinderSize, kindCategory, nameGroup, sizeGroup } from "../../lib/arrange";
import { flattenGroups, groupIds as groupIdsAll, groupRows, levelState, setLevelCollapsed, toggleCollapsed, type GroupKey, type GroupLevel, type RowGroup } from "../../lib/dbGroups";
import {
  CELL_PADDING,
  cellBoxStyle,
  moveColumnId,
  orderColumns,
  type ColumnDef,
  type SortState,
} from "../../lib/columns";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import OverflowBar from "../shell/OverflowBar";
import { measureText, uiFont } from "../../lib/textMeasure";
import { useColumnLayout } from "../../hooks/useColumnLayout";
import TableHeader from "./shared/TableHeader";
import { useSelection } from "../../hooks/useSelection";
import { useUndo } from "../../hooks/useUndo";
import { setUndoTarget } from "../../lib/editMenu";
import { selectionLabel } from "../../lib/selectionStatus";
import { describeRefresh, type RefreshSummary } from "../../lib/refreshSummary";
import MenuPopover, { type MenuAnchor } from "../shared/MenuPopover";
import Dialog, { DialogButton } from "../shared/Dialog";
import { useOverwriteConfirm } from "../shared/OverwriteDialog";
import CloudBadge from "./shared/CloudBadge";
import {
  DRAG_THRESHOLD,
  DROP_DWELL_MS,
  columnAtOffset,
  columnOffset,
  countFoldersNamed,
  coveredValues,
} from "../../lib/tagDrag";
import { hasPrimaryModifier, isToggleSelect } from "../../lib/platform";
import {
  CURRENCIES,
  EXTRACTED_KEYS,
  EXTRACTED_LABELS,
  propertyLabel,
  coerceValue,
  dateKey,
  defaultCurrency,
  editText,
  formatValue,
  listValues,
  newPropertyKinds,
  uniqueName,
  parseConfig,
  parseInput,
  valueToText,
} from "../../lib/propertyTypes";
import { applyFilters, cycleSort, multiSort, newRule, type ColumnKind, type FilterMatch, type FilterRule } from "../../lib/dbTable";
import {
  EMPTY_CELLS,
  cellKey,
  clickCell,
  copyGrid,
  fillWrites,
  isSolidRect,
  moveCell,
  parseCellKey,
  parseTsv,
  pasteWrites,
  pruneCells,
  rectCells,
  toTsv,
  type CellRef,
  type CellSelection,
  type CellWrite,
} from "../../lib/cellSelection";
import FilterSortPopover, { type FilterColumn } from "./db/FilterSortPopover";
import { HeaderNameEditor, ListCellEditor, ValueListEditor, PropertyValueView, TextCellEditor, type CommitMove } from "./db/CellEditors";

interface Props {
  files: FileRecord[];
  locationId: string;
  /** Called after file data changes here (edits, mapping, property changes) so the files reload. */
  onChanged?: () => void;
}

interface IndexingProgress {
  location_id: string;
  files_scanned: number;
  done: boolean;
  /** On the final event: what changed, or why it failed. */
  summary?: RefreshSummary | null;
  error?: string | null;
}

function fileName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

function fileExtension(filePath: string): string {
  const name = fileName(filePath);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// Standard columns, in display order. Name is always shown.
const STANDARD_COLUMNS: ColumnDef[] = [
  { id: "name", label: "Name", weight: 3, minWidth: 140, reorderable: false, hideable: false },
  { id: "ext", label: "Ext", weight: 0.6, minWidth: 50 },
  { id: "path", label: "Path", weight: 4, minWidth: 120 },
  // Kind as Group By buckets it ("Images", "Spreadsheets"); Ext gives the exact format.
  // The id stays "type" so saved column settings carry over
  { id: "type", label: "Kind", weight: 1.4, minWidth: 90 },
  { id: "size", label: "Size", weight: 0.9, minWidth: 70, align: "right" },
  { id: "created", label: "Created", weight: 1.2, minWidth: 100 },
  { id: "modified", label: "Modified", weight: 1.2, minWidth: 100 },
];
/** Source tags: the folder names on each file's path, read-only (the "Tags" property holds hand-added ones). */
const TAGS_COLUMN: ColumnDef = { id: "tags", label: "Source Tags", weight: 2, minWidth: 120, sortable: false };
/** The trailing header cell holding "+" (add property) and "…" (show or hide columns). */
const ADD_COLUMN: ColumnDef = {
  id: "__add",
  label: "",
  weight: 0,
  minWidth: 56,
  sortable: false,
  reorderable: false,
  hideable: false,
  resizable: false,
};
const PROP_PREFIX = "prop:";
const propName = (columnId: string) => columnId.slice(PROP_PREFIX.length);

const NATIVE_KINDS: Record<string, ColumnKind> = {
  name: "text",
  ext: "list",
  path: "text",
  type: "list",
  size: "number",
  created: "date",
  modified: "date",
  tags: "list",
};
const KIND_BY_TYPE: Record<ValueType, ColumnKind> = {
  free_text: "text",
  number: "number",
  date: "date",
  enum: "list",
  array: "list",
};

function propertyColumn(name: string, type: ValueType): ColumnDef {
  return { id: PROP_PREFIX + name, label: propertyLabel(name), weight: 1.4, minWidth: 90, align: type === "number" ? "right" : undefined };
}

/** A column's name as its header shows it. */
function columnLabel(columnId: string): string {
  if (columnId.startsWith(PROP_PREFIX)) return propertyLabel(columnId.slice(PROP_PREFIX.length));
  return [...STANDARD_COLUMNS, TAGS_COLUMN].find((c) => c.id === columnId)?.label ?? columnId;
}

/** A new grouping level's order: newest and largest first for dates and sizes, as Finder groups them. */
function defaultGroupDirection(columnId: string): "asc" | "desc" {
  return columnId === "created" || columnId === "modified" || columnId === "size" ? "desc" : "asc";
}

/** A native column's value for filtering. */
function nativeValue(file: FileRecord, key: string): unknown {
  switch (key) {
    case "name":
      return fileName(file.file_path);
    case "ext":
      return fileExtension(file.file_path);
    case "path":
      return file.relative_path ?? file.file_path;
    case "type":
      return kindCategory(file);
    case "size":
      return file.file_size;
    case "created":
      return file.timestamp;
    case "modified":
      return file.modified_at;
    case "tags":
      return Array.isArray(file.tags) ? file.tags : [];
    default:
      return null;
  }
}

function metaValue(file: FileRecord | undefined, key: string): unknown {
  return (file?.metadata as Record<string, unknown> | null | undefined)?.[key] ?? null;
}

const isEmptyValue = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const CELL = "shrink-0 px-3 truncate whitespace-nowrap";
// Finder list metrics: 20pt rows, rounded stripes inset 10px.
const ROW_HEIGHT = 20;
/** A group's heading row, with room above it to set it off from the rows before. */
const GROUP_HEIGHT = 30;
/** Each nested grouping level's heading steps in by this much. */
const GROUP_INDENT = 16;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const INSET = 10;

const TOOLBAR_BUTTON = "px-2.5 py-1 text-xs rounded-md border whitespace-nowrap transition-colors";
const TOOLBAR_BUTTON_IDLE = "border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600";
const TOOLBAR_BUTTON_ACTIVE = "border-blue-500/60 text-blue-400 hover:text-blue-300 hover:border-blue-400";
const DEFAULT_SORT: SortState = { key: "path", direction: "asc" };

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};
const MOVES: Record<CommitMove, [number, number]> = {
  down: [1, 0],
  up: [-1, 0],
  right: [0, 1],
  left: [0, -1],
  none: [0, 0],
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Column preferences are a convenience; ignore storage failures
  }
}

export default function LocationDatabaseView({ files, locationId, onChanged }: Props) {
  const [search, setSearch] = useState("");
  const [sorts, setSorts] = useState<SortState[]>([DEFAULT_SORT]);
  /** Grouping levels (outermost first) and the groups folded shut; both kept per location. */
  const [groupLevels, setGroupLevelsState] = useState<GroupLevel[]>([]);
  const [collapsed, setCollapsedState] = useState<ReadonlySet<string>>(() => new Set());
  const [rules, setRules] = useState<FilterRule[]>([]);
  const [match, setMatch] = useState<FilterMatch>("all");
  const [indexing, setIndexing] = useState<{
    scanned: number;
    done: boolean;
    summary?: RefreshSummary | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The Columns button while its checklist is open. */
  /**
   * The open property menu: from the Properties or "…" button (the property
   * list), or from right-clicking a header (that property's actions, then the list).
   */
  const [propertyMenu, setPropertyMenu] = useState<{ anchor: MenuAnchor; columnId?: string | null } | null>(null);
  /** The Filter or Sort panel, while open. */
  const [panel, setPanel] = useState<"filter" | "sort" | "group" | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const groupButtonRef = useRef<HTMLButtonElement>(null);
  /** A property whose name is being edited in its header. */
  const [renaming, setRenaming] = useState<{ name: string; text: string; error?: string } | null>(null);
  /** Sort order before the last header click, restored when that click turns out to start a double-click. */
  const sortsBeforeClick = useRef<SortState[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** A list column whose values are being edited (Edit Values…), and the header it opens from. */
  const [valuesEditor, setValuesEditor] = useState<{ columnId: string; anchor: HTMLElement } | null>(null);
  const [hasMappings, setHasMappings] = useState(false);
  const { structureLocationId, openStructureMapping } = useNavigation();
  const structureOpen = structureLocationId === locationId;

  // Column visibility
  const [hiddenStandard, setHiddenStandard] = useState<string[]>([]);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [showTags, setShowTags] = useState(false);
  /** Source Tags shows only tags not yet recorded in a property. */
  const [hideCovered, setHideCovered] = useState(false);
  const [visibleProperties, setVisibleProperties] = useState<string[]>([]);
  /** Metadata keys present on this location's files. */
  const [metadataKeys, setMetadataKeys] = useState<string[]>([]);
  const [frozen, setFrozen] = useState(true);
  /** Multi-select properties whose values stay on one line (the rest wrap, the default). */
  const [noWrap, setNoWrap] = useState<string[]>([]);
  /** Source Tags wrap like a Multi-select, unless turned off. */
  const [wrapSourceTags, setWrapSourceTags] = useState(true);
  const [scrolledX, setScrolledX] = useState(false);

  // Property registry for this location's library
  const [library, setLibrary] = useState<string | null>(null);
  const [registry, setRegistry] = useState<Property[]>([]);
  /** Registered values of Select and Multi-select properties, by property id. */
  const [registryValues, setRegistryValues] = useState<Record<string, PropertyValue[]>>({});

  // Edits show at once; the files reload once the writes finish
  const [patches, setPatches] = useState<Map<string, Record<string, unknown>>>(() => new Map());
  /**
   * A Multi-select cell's ticks while its picker is open: shown in the cell at
   * once, written (as one undoable edit) when the picker closes. Kept apart from
   * `patches` so a reload mid-edit (after a rename, say) doesn't drop it.
   */
  const [listPreview, setListPreview] = useState<{ file_id: string; key: string; value: unknown } | null>(null);
  // Read at commit time, which may come from a handler bound before the last tick
  const listPreviewRef = useRef(listPreview);
  listPreviewRef.current = listPreview;
  const pendingWrites = useRef(0);
  const history = useUndo(
    locationId,
    (e) => setError(String(e)),
    (h) =>
      setEditMenuLabels(
        h.past[h.past.length - 1]?.label ?? null,
        h.future[h.future.length - 1]?.label ?? null
      ).catch(() => {})
  );

  // Reset view state and load column prefs when switching locations
  useEffect(() => {
    setSearch("");
    setSorts([DEFAULT_SORT]);
    setRules([]);
    setMatch("all");
    setIndexing(null);
    setError(null);
    setPropertyMenu(null);
    setPanel(null);
    setRenaming(null);
    setPatches(new Map());

    setShowTags(loadJson(`col-tags-${locationId}`, false));
    setHideCovered(loadJson(`col-tags-hide-covered-${locationId}`, false));
    setVisibleProperties(loadJson<string[]>(`col-props-${locationId}`, []));
    setHiddenStandard(loadJson<string[]>(`col-hidden-${locationId}`, []));
    setColumnOrder(loadJson<string[]>(`col-order-${locationId}`, []));
    setFrozen(loadJson(`col-freeze-${locationId}`, true));
    setNoWrap(loadJson<string[]>(`col-nowrap-${locationId}`, []));
    setWrapSourceTags(loadJson(`col-wrap-source-${locationId}`, true));
    setGroupLevelsState(loadJson<GroupLevel[]>(`col-group-${locationId}`, []));
    setCollapsedState(new Set(loadJson<string[]>(`col-group-collapsed-${locationId}`, [])));
  }, [locationId]);

  function setGroupLevels(next: GroupLevel[] | ((prev: GroupLevel[]) => GroupLevel[])) {
    setGroupLevelsState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      saveJson(`col-group-${locationId}`, value);
      return value;
    });
  }

  function setCollapsed(next: ReadonlySet<string>) {
    setCollapsedState(next);
    saveJson(`col-group-collapsed-${locationId}`, [...next]);
  }

  useEffect(() => {
    getLocations()
      .then((locs) => setLibrary(locs.find((l) => l.location_id === locationId)?.library ?? null))
      .catch(() => {});
  }, [locationId]);

  const loadKeys = useCallback(() => {
    getLocationProperties(locationId)
      .then(setMetadataKeys)
      .catch(() => {});
  }, [locationId]);
  useEffect(loadKeys, [loadKeys]);

  // Re-read mappings and keys whenever Map Structure closes (and on load)
  useEffect(() => {
    if (structureOpen) return;
    getMappingNodes(locationId)
      .then((nodes) => setHasMappings(nodes.length > 0))
      .catch(() => {});
    loadKeys();
  }, [locationId, structureOpen, loadKeys]);

  const loadRegistry = useCallback(async () => {
    if (!library) {
      setRegistry([]);
      return;
    }
    setRegistry(await getProperties(library));
  }, [library]);
  useEffect(() => {
    loadRegistry().catch(() => {});
  }, [loadRegistry]);

  // Fetch registered values for list properties that don't have them yet
  useEffect(() => {
    const need = registry.filter(
      (p) => (p.value_type === "enum" || p.value_type === "array") && !(p.property_id in registryValues)
    );
    if (need.length === 0) return;
    Promise.all(
      need.map((p) => getPropertyValues(p.property_id).then((vs) => [p.property_id, vs] as const))
    )
      .then((entries) => setRegistryValues((prev) => ({ ...prev, ...Object.fromEntries(entries) })))
      .catch(() => {});
  }, [registry, registryValues]);

  // Progress banner (a refresh started from the sidebar) + reload properties when it finishes
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<IndexingProgress>("indexing_progress", (event) => {
      const p = event.payload;
      if (p.location_id !== locationId) return;
      setIndexing(p.done && p.error ? null : { scanned: p.files_scanned, done: p.done, summary: p.summary });
      if (p.done) {
        setTimeout(() => setIndexing(null), 2500);
        loadKeys();
        loadRegistry().catch(() => {});
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [locationId, loadKeys, loadRegistry]);

  // ── Properties ────────────────────────────────────────────────────────────

  /** Library-scoped properties win over global ones of the same name. */
  const propByName = useMemo(() => {
    const map = new Map<string, Property>();
    for (const p of registry) {
      if (!map.has(p.name) || p.library != null) map.set(p.name, p);
    }
    return map;
  }, [registry]);

  const typeOf = useCallback((name: string): ValueType => propByName.get(name)?.value_type ?? "free_text", [propByName]);
  /** The library's built-in Tags property (hand-added tags), by its current name. */
  const tagsProperty = useMemo(
    () => registry.find((p) => p.library === library && parseConfig(p).system === "tags")?.name ?? null,
    [registry, library]
  );
  const configOf = useCallback((name: string): PropertyConfig => parseConfig(propByName.get(name)), [propByName]);

  /** Every property this location can show: registered ones and keys found on its files. */
  const availableProperties = useMemo(
    () =>
      [...new Set([...metadataKeys, ...registry.map((p) => p.name)])]
        .filter((n) => !n.startsWith("_"))
        .sort((a, b) => a.localeCompare(b)),
    [metadataKeys, registry]
  );
  const shownProperties = useMemo(
    () => visibleProperties.filter((p) => availableProperties.includes(p)),
    [visibleProperties, availableProperties]
  );

  /** Custom property cells are editable; native columns and values read from the file are not. */
  const isEditable = useCallback(
    (columnId: string) => columnId.startsWith(PROP_PREFIX) && !EXTRACTED_KEYS.has(propName(columnId)),
    []
  );

  const kindOf = useCallback(
    (columnId: string): ColumnKind =>
      columnId.startsWith(PROP_PREFIX) ? KIND_BY_TYPE[typeOf(propName(columnId))] : NATIVE_KINDS[columnId] ?? "text",
    [typeOf]
  );

  // ── Rows: edits applied, then search, filters and sort ─────────────────────

  const rows = useMemo(() => {
    if (patches.size === 0 && !listPreview) return files;
    return files.map((f) => {
      const patch = patches.get(f.file_id);
      const preview = listPreview?.file_id === f.file_id ? { [listPreview.key]: listPreview.value } : null;
      if (!patch && !preview) return f;
      const metadata: Record<string, unknown> = { ...(f.metadata ?? {}) };
      for (const [k, v] of Object.entries({ ...patch, ...preview })) {
        if (v == null) delete metadata[k];
        else metadata[k] = v;
      }
      return { ...f, metadata };
    });
  }, [files, patches, listPreview]);

  // Fresh data from disk replaces the optimistic edits once no writes are in flight
  useEffect(() => {
    if (pendingWrites.current === 0) setPatches((p) => (p.size === 0 ? p : new Map()));
  }, [files]);

  const columnValue = useCallback(
    (file: FileRecord, columnId: string): unknown =>
      columnId.startsWith(PROP_PREFIX) ? metaValue(file, propName(columnId)) : nativeValue(file, columnId),
    []
  );

  const sortValue = useCallback(
    (file: FileRecord, columnId: string): string | number | null | undefined => {
      if (!columnId.startsWith(PROP_PREFIX)) {
        const v = nativeValue(file, columnId);
        return Array.isArray(v) ? v.join(", ") : (v as string | number | null);
      }
      const name = propName(columnId);
      const v = metaValue(file, name);
      if (v == null) return null;
      const type = typeOf(name);
      if (type === "number" && typeof v === "number") return v;
      if (type === "date") return dateKey(v) ?? valueToText(v);
      return valueToText(v);
    },
    [typeOf]
  );

  // Only re-filter and re-sort when the inputs change, not on every render
  // (column drags and selection clicks re-render many times a second)
  const matched = useMemo(() => {
    const q = search.toLowerCase();
    const searched = q
      ? rows.filter(
          (f) =>
            fileName(f.file_path).toLowerCase().includes(q) ||
            (f.relative_path ?? "").toLowerCase().includes(q)
        )
      : rows;
    return multiSort(applyFilters(searched, rules, match, columnValue, kindOf), sorts, sortValue);
  }, [rows, search, rules, match, sorts, columnValue, kindOf, sortValue]);

  /** Which group a file falls in for a column: Finder's buckets for its own columns, the value for properties. */
  const groupKey = useCallback(
    (file: FileRecord, columnId: string): GroupKey | null => {
      const bucket = ([label, rank]: [string, number]) => ({ label, rank });
      if (!columnId.startsWith(PROP_PREFIX)) {
        switch (columnId) {
          case "name":
            return bucket(nameGroup(file));
          case "type": {
            const category = kindCategory(file);
            return { label: category, rank: KIND_CATEGORIES.indexOf(category) };
          }
          case "size":
            if (file.file_size == null) return null;
            // Buckets run largest first; ranked so ascending is smallest first
            return { ...bucket(sizeGroup(file.file_size)), rank: -sizeGroup(file.file_size)[1] };
          case "created":
          case "modified": {
            const iso = columnId === "created" ? file.timestamp : file.modified_at ?? file.timestamp;
            if (!iso) return null;
            // Ranked so ascending is oldest first (Finder's buckets count back from today)
            const [label, rank] = dateGroup(iso, new Date());
            return { label, rank: -rank };
          }
          case "path": {
            const rel = (file.relative_path ?? "").replace(/\\/g, "/");
            const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
            return { label: folder || "Top Level", rank: folder };
          }
          default: {
            const v = nativeValue(file, columnId);
            const list = listValues(v);
            if (list.length === 0) return v == null || v === "" ? null : { label: String(v), rank: String(v) };
            const label = [...list].sort((a, b) => a.localeCompare(b)).join(", ");
            return { label, rank: label };
          }
        }
      }
      const name = propName(columnId);
      const v = metaValue(file, name);
      if (isEmptyValue(v)) return null;
      const type = typeOf(name);
      if (type === "number" && typeof v === "number") return { label: valueToText(v), rank: v };
      if (type === "date") {
        const key = dateKey(v);
        if (!key) return { label: valueToText(v), rank: valueToText(v) };
        const [year, month] = key.split("-");
        return { label: `${MONTH_NAMES[Number(month) - 1]} ${year}`, rank: `${year}-${month}` };
      }
      if (type === "array") {
        // A file with several values is grouped under that combination
        const label = [...listValues(v)].sort((a, b) => a.localeCompare(b)).join(", ");
        return { label, rank: label };
      }
      return { label: valueToText(v), rank: valueToText(v) };
    },
    [typeOf]
  );

  // Grouped: headings and rows in display order; `sorted` is the rows left showing
  const groups = useMemo(() => {
    if (groupLevels.length === 0) return null;
    return groupRows(matched, groupLevels, groupKey, (columnId) => `No ${columnLabel(columnId)}`);
  }, [matched, groupLevels, groupKey]);
  const { items, rows: sorted } = useMemo(() => flattenGroups(matched, groups, collapsed), [matched, groups, collapsed]);
  /** Each visible row's position in `items` (which also holds the group headings). */
  const itemOfRow = useMemo(() => {
    const out: number[] = [];
    items.forEach((item, i) => {
      if (item.type === "row") out.push(i);
    });
    return out;
  }, [items]);

  // ── Columns ───────────────────────────────────────────────────────────────

  function toggleStandard(id: string) {
    if (id === "name") return;
    const next = hiddenStandard.includes(id)
      ? hiddenStandard.filter((c) => c !== id)
      : [...hiddenStandard, id];
    setHiddenStandard(next);
    saveJson(`col-hidden-${locationId}`, next);
  }

  function toggleShowTags() {
    const next = !showTags;
    setShowTags(next);
    saveJson(`col-tags-${locationId}`, next);
  }

  function toggleHideCovered() {
    const next = !hideCovered;
    setHideCovered(next);
    saveJson(`col-tags-hide-covered-${locationId}`, next);
  }

  /** A file's source tags as shown: without the covered ones when those are hidden. */
  /** Folder names behind renamed values ("Apollo" ← "01 Apollo"), across this library's list properties. */
  const aliasSources = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const values of Object.values(registryValues)) {
      for (const v of values) if (v.sources?.length) map.set(v.value, [...(map.get(v.value) ?? []), ...v.sources]);
    }
    return map;
  }, [registryValues]);

  /** Source tags a file's properties account for, counting folder names whose values were renamed. */
  const coveredFor = useCallback(
    (file: FileRecord): Set<string> => {
      const covered = coveredValues(file.metadata as Record<string, unknown> | null);
      for (const v of [...covered]) for (const source of aliasSources.get(v) ?? []) covered.add(source);
      return covered;
    },
    [aliasSources]
  );

  const shownSourceTags = useCallback(
    (file: FileRecord): string[] => {
      const tags = Array.isArray(file.tags) ? file.tags : [];
      if (!hideCovered) return tags;
      const covered = coveredFor(file);
      return tags.filter((t) => !covered.has(t));
    },
    [hideCovered, coveredFor]
  );

  /** Updates the shown property columns from their latest value (safe inside undo). */
  function updateVisibleProperties(update: (prev: string[]) => string[]) {
    setVisibleProperties((prev) => {
      const next = update(prev);
      saveJson(`col-props-${locationId}`, next);
      return next;
    });
  }

  function toggleProperty(name: string) {
    updateVisibleProperties((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
  }

  function toggleWrap(name: string) {
    setNoWrap((prev) => {
      const next = prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name];
      saveJson(`col-nowrap-${locationId}`, next);
      return next;
    });
  }

  function toggleWrapSourceTags() {
    setWrapSourceTags((w) => {
      saveJson(`col-wrap-source-${locationId}`, !w);
      return !w;
    });
  }

  /** Multi-select values wrap onto more lines, growing the row, unless turned off. */
  const wraps = useCallback((name: string) => typeOf(name) === "array" && !noWrap.includes(name), [typeOf, noWrap]);

  function toggleFrozen() {
    setFrozen((f) => {
      saveJson(`col-freeze-${locationId}`, !f);
      return !f;
    });
  }

  const columns = useMemo(
    () => [
      ...orderColumns(
        [
          ...STANDARD_COLUMNS.filter((c) => !hiddenStandard.includes(c.id)),
          ...(showTags ? [TAGS_COLUMN] : []),
          ...shownProperties.map((name) => propertyColumn(name, typeOf(name))),
        ],
        columnOrder
      ),
      ADD_COLUMN,
    ],
    [hiddenStandard, showTags, shownProperties, columnOrder, typeOf]
  );

  function handleReorder(columnId: string, targetIndex: number) {
    const ids = columns.filter((c) => c.id !== ADD_COLUMN.id).map((c) => c.id);
    const visibleIds = moveColumnId(ids, columnId, targetIndex);
    // Keep saved positions of currently hidden columns after the visible ones.
    const next = [...visibleIds, ...columnOrder.filter((id) => !visibleIds.includes(id))];
    setColumnOrder(next);
    saveJson(`col-order-${locationId}`, next);
  }

  /** Rendered width of a cell's content, for double-click-to-fit. */
  function measureCell(file: FileRecord, key: string): number {
    const body = uiFont(13);
    if (key === ADD_COLUMN.id) return 0;
    if (key === "tags") return measurePills(shownSourceTags(file));
    if (key === "name") return measureText(fileName(file.file_path), body) + 22; // icon + gap
    if (key.startsWith(PROP_PREFIX)) {
      const name = propName(key);
      const value = metaValue(file, name);
      const type = typeOf(name);
      if (type === "enum" || type === "array") return measurePills(listValues(value));
      return measureText(formatValue(value, type, configOf(name)), body);
    }
    const text: Record<string, string> = {
      ext: fileExtension(file.file_path),
      path: file.relative_path ?? file.file_path,
      type: kindCategory(file),
      size: formatFinderSize(file.file_size),
      created: formatFinderDate(file.timestamp),
      modified: formatFinderDate(file.modified_at),
    };
    return measureText(text[key] ?? "", body);
  }

  const layout = useColumnLayout(
    columns,
    `db-${locationId}`,
    (key) => matched.map((f) => measureCell(f, key)),
    INSET,
    hideColumn
  );

  /** Hides a column the way its menu checkbox does. */
  function hideColumn(id: string) {
    if (id === TAGS_COLUMN.id) {
      if (showTags) toggleShowTags();
    } else if (id.startsWith(PROP_PREFIX)) {
      if (visibleProperties.includes(propName(id))) toggleProperty(propName(id));
    } else if (!hiddenStandard.includes(id)) {
      toggleStandard(id);
    }
  }

  // Bulk visibility. Native: the standard columns, Source Tags and values read
  // from the file (EXIF). Custom: the editable properties.
  // In More Info order (Camera Make, Camera Model, Date Taken…), not alphabetical
  const extractedProperties = Object.keys(EXTRACTED_LABELS).filter((p) => availableProperties.includes(p));
  const customProperties = availableProperties.filter((p) => !EXTRACTED_KEYS.has(p));
  const allNativeShown =
    hiddenStandard.length === 0 && showTags && extractedProperties.every((p) => visibleProperties.includes(p));
  const allCustomShown = customProperties.every((p) => visibleProperties.includes(p));

  function setNativeShown(shown: boolean) {
    const next = shown ? [] : STANDARD_COLUMNS.map((c) => c.id).filter((id) => id !== "name");
    setHiddenStandard(next);
    saveJson(`col-hidden-${locationId}`, next);
    setShowTags(shown);
    saveJson(`col-tags-${locationId}`, shown);
    setPropertiesShown(extractedProperties, shown);
  }

  function setPropertiesShown(names: string[], shown: boolean) {
    updateVisibleProperties((prev) =>
      shown ? [...prev, ...names.filter((p) => !prev.includes(p))] : prev.filter((p) => !names.includes(p))
    );
  }

  // Empty and non-empty are judged on the rows shown now (after search and
  // filters), for the custom columns only; the result is a one-off change to
  // the visibility settings
  const hasValue = (name: string) => matched.some((f) => !isEmptyValue(metaValue(f, name)));
  const emptyShown =
    matched.length > 0 ? customProperties.filter((p) => visibleProperties.includes(p) && !hasValue(p)) : [];
  const nonEmptyHidden = customProperties.filter((p) => !visibleProperties.includes(p) && hasValue(p));

  const allExtractedShown = extractedProperties.every((p) => visibleProperties.includes(p));

  function propertyEntry(name: string): MenuEntry {
    return {
      type: "check",
      text: propertyLabel(name),
      checked: visibleProperties.includes(name),
      action: () => toggleProperty(name),
      key: PROP_PREFIX + name,
      // Custom properties can be deleted from here (not values read from the file, nor the built-in Tags)
      onDelete:
        EXTRACTED_KEYS.has(name) || name === tagsProperty
          ? undefined
          : { confirm: deleteConfirmText(name), action: () => void deletePropertyNamed(name) },
    };
  }

  /** "Delete “Client” from 12 files?" */
  function deleteConfirmText(name: string): string {
    const count = rows.filter((f) => metaValue(f, name) != null).length;
    return count > 0 ? `Delete “${name}” from ${count.toLocaleString()} file${count === 1 ? "" : "s"}?` : `Delete “${name}”?`;
  }

  function columnMenuEntries(): MenuEntry[] {
    return [
      {
        type: "item",
        text: "Show All Properties",
        enabled: !(allNativeShown && allCustomShown),
        action: () => {
          setNativeShown(true);
          setPropertiesShown(customProperties, true);
        },
      },
      {
        type: "item",
        text: allNativeShown ? "Hide All Native Properties" : "Show All Native Properties",
        action: () => setNativeShown(!allNativeShown),
      },
      {
        type: "item",
        text: allCustomShown ? "Hide All Custom Properties" : "Show All Custom Properties",
        action: () => setPropertiesShown(customProperties, !allCustomShown),
      },
      { type: "separator" },
      {
        type: "item",
        text: "Hide Empty Custom Properties",
        enabled: emptyShown.length > 0,
        action: () => setPropertiesShown(emptyShown, false),
      },
      {
        type: "item",
        text: "Show Non-Empty Custom Properties",
        enabled: nonEmptyHidden.length > 0,
        action: () => setPropertiesShown(nonEmptyHidden, true),
      },
      { type: "separator" },
      ...STANDARD_COLUMNS.map((c) => ({
        type: "check" as const,
        text: c.label,
        checked: !hiddenStandard.includes(c.id),
        enabled: c.id !== "name",
        action: () => toggleStandard(c.id),
        key: c.id,
      })),
      { type: "check", text: TAGS_COLUMN.label, checked: showTags, action: toggleShowTags, key: TAGS_COLUMN.id },
      // Values read from the file (EXIF), grouped as in Finder's Get Info
      ...(extractedProperties.length > 0
        ? [
            {
              type: "submenu" as const,
              text: "More Info",
              items: [
                {
                  type: "item" as const,
                  text: "Show All",
                  enabled: !allExtractedShown,
                  action: () => setPropertiesShown(extractedProperties, true),
                },
                {
                  type: "item" as const,
                  text: "Hide All",
                  enabled: extractedProperties.some((p) => visibleProperties.includes(p)),
                  action: () => setPropertiesShown(extractedProperties, false),
                },
                { type: "separator" as const },
                ...extractedProperties.map(propertyEntry),
              ],
            },
          ]
        : []),
      ...(customProperties.length > 0 ? [{ type: "separator" as const }, ...customProperties.map(propertyEntry)] : []),
      { type: "separator" },
      { type: "item", text: "Size All Properties to Fit", action: layout.fitAll },
    ];
  }

  const closeColumnsMenu = useCallback(() => setPropertyMenu(null), []);
  const closePanel = useCallback(() => setPanel(null), []);
  /** Right-click on a group heading: this group, its level, or every group. */
  function showGroupMenu(e: React.MouseEvent, group: RowGroup<FileRecord>, isCollapsed: boolean) {
    e.preventDefault();
    e.stopPropagation();
    if (!groups) return;
    const level = groupLevels[group.depth];
    const levelName = level ? columnLabel(level.key) : "";
    const state = levelState(collapsed, groups, group.depth);
    const allShut = groupIdsAll(groups).every((id) => collapsed.has(id));
    showContextMenu(
      [
        {
          type: "item",
          text: isCollapsed ? `Expand “${group.label}”` : `Collapse “${group.label}”`,
          action: () => setCollapsed(toggleCollapsed(collapsed, group, groups)),
        },
        { type: "separator" },
        {
          type: "item",
          text: `Collapse All ${levelName} Groups`,
          enabled: state !== "collapsed",
          action: () => setCollapsed(setLevelCollapsed(collapsed, groups, group.depth, true)),
        },
        {
          type: "item",
          text: `Expand All ${levelName} Groups`,
          enabled: state !== "expanded",
          action: () => setCollapsed(setLevelCollapsed(collapsed, groups, group.depth, false)),
        },
        ...(groupLevels.length > 1
          ? ([
              { type: "separator" },
              {
                type: "item",
                text: "Collapse All Groups",
                enabled: !allShut,
                action: () => setCollapsed(new Set(groupIdsAll(groups))),
              },
              { type: "item", text: "Expand All Groups", enabled: collapsed.size > 0, action: () => setCollapsed(new Set()) },
            ] as MenuEntry[])
          : []),
      ],
      { event: e }
    );
  }

  const panelButton = (p: "filter" | "sort" | "group") =>
    p === "filter" ? filterButtonRef : p === "sort" ? sortButtonRef : groupButtonRef;

  // ── Property management ───────────────────────────────────────────────────

  // Each change below is split into a "core" step, which only does the work and
  // is safe to run again from undo/redo (it looks properties up afresh and
  // updates state from its latest value), and a user action that queues the
  // core step and records how to reverse it.

  /** The registry entry for `name` as it is now, library-scoped first. */
  async function findProperty(name: string): Promise<Property | undefined> {
    const props = await getProperties(library ?? undefined);
    return props.find((p) => p.name === name && p.library === library) ?? props.find((p) => p.name === name);
  }

  /** The registry entry for `name`, registering a key found only on files as Text. */
  async function ensureProperty(name: string): Promise<Property> {
    return (await findProperty(name)) ?? createProperty(name, library, "free_text");
  }

  /** After a property changes: reload the registry, the keys and the files. */
  async function afterPropertyChange() {
    setRegistryValues({});
    await loadRegistry();
    loadKeys();
    onChanged?.();
  }

  /** Every file's current value for `name`, to put back on undo. */
  function snapshot(name: string): CellEdit[] {
    return rows.flatMap((f) => {
      const value = metaValue(f, name);
      return value == null ? [] : [{ file_id: f.file_id, key: name, value }];
    });
  }

  /** Writes saved values back (after an undo has restored their property). */
  async function restoreValues(edits: CellEdit[]) {
    if (edits.length > 0) await setMetadataCells(edits);
    await afterPropertyChange();
  }

  function renameInView(from: string, to: string) {
    const oldId = PROP_PREFIX + from;
    const newId = PROP_PREFIX + to;
    updateVisibleProperties((prev) => prev.map((p) => (p === from ? to : p)));
    setColumnOrder((prev) => {
      const next = prev.map((id) => (id === oldId ? newId : id));
      saveJson(`col-order-${locationId}`, next);
      return next;
    });
    setRules((rs) => rs.map((r) => (r.column === oldId ? { ...r, column: newId } : r)));
    setSorts((ss) => ss.map((s) => (s.key === oldId ? { ...s, key: newId } : s)));
    setGroupLevels((gs) => gs.map((g) => (g.key === oldId ? { ...g, key: newId } : g)));
  }

  function removeFromView(name: string) {
    updateVisibleProperties((prev) => prev.filter((p) => p !== name));
    setRules((rs) => rs.filter((r) => r.column !== PROP_PREFIX + name));
    setSorts((ss) => ss.filter((s) => s.key !== PROP_PREFIX + name));
    setGroupLevels((gs) => gs.filter((g) => g.key !== PROP_PREFIX + name));
  }

  async function coreCreate(name: string, type: ValueType, configJson: string | null) {
    if (!library) throw new Error("This location has no library");
    if (await findProperty(name)) {
      await createProperty(name, library, type, configJson); // reports the clash
    } else if (metadataKeys.includes(name)) {
      // Files already carry this key: adopt it, converting their values to the new type
      const prop = await createProperty(name, library, "free_text");
      if (type !== "free_text" || configJson) await updatePropertyType(prop.property_id, type, configJson);
    } else {
      await createProperty(name, library, type, configJson);
    }
    updateVisibleProperties((prev) => (prev.includes(name) ? prev : [...prev, name]));
    await afterPropertyChange();
  }

  async function coreDelete(name: string) {
    const prop = await findProperty(name);
    if (prop) await deleteProperty(prop.property_id);
    removeFromView(name);
    await afterPropertyChange();
  }

  async function coreRename(from: string, to: string) {
    const prop = await ensureProperty(from);
    await renameProperty(prop.property_id, to);
    renameInView(from, to);
    await afterPropertyChange();
  }

  async function coreSetType(name: string, type: ValueType, configJson: string | null) {
    const prop = await ensureProperty(name);
    await updatePropertyType(prop.property_id, type, configJson);
    await afterPropertyChange();
  }

  /** "+": adds a column of this type, named after it, with the name ready to type over. Returns its name. */
  async function addProperty(label: string, type: ValueType, config: PropertyConfig | null): Promise<string | null> {
    const name = uniqueName(label, availableProperties);
    const configJson = config ? JSON.stringify(config) : null;
    // Values already on files under this name (adopted), to put back if the add is undone
    const before = snapshot(name);
    try {
      await history.queue(() => coreCreate(name, type, configJson));
    } catch (e) {
      setError(String(e));
      return null;
    }
    history.push({
      label: "Add Property",
      undo: async () => {
        await coreDelete(name);
        if (before.length > 0) await restoreValues(before);
      },
      redo: () => coreCreate(name, type, configJson),
    });
    setRenaming({ name, text: name });
    return name;
  }

  function showAddMenu(e: React.MouseEvent) {
    showContextMenu(
      newPropertyKinds().map((k): MenuEntry => ({ type: "item", text: k.label, action: () => addProperty(k.label, k.type, k.config) })),
      { event: e }
    );
  }

  async function changeType(name: string, type: ValueType, config: PropertyConfig | null) {
    const prev = propByName.get(name);
    const prevType = prev?.value_type ?? "free_text";
    const prevConfig = prev?.config ?? null;
    const configJson = config ? JSON.stringify(config) : null;
    // Conversions can merge values (a list joined into text), so undo restores them exactly
    const before = snapshot(name);
    try {
      await history.queue(() => coreSetType(name, type, configJson));
    } catch (e) {
      setError(String(e));
      return;
    }
    history.push({
      label: "Change Property Type",
      undo: async () => {
        await coreSetType(name, prevType, prevConfig);
        await restoreValues(before);
      },
      redo: () => coreSetType(name, type, configJson),
    });
  }

  async function submitRename(text: string) {
    if (!renaming) return;
    const from = renaming.name;
    const to = text.trim();
    if (!to || to === from) {
      setRenaming(null);
      return;
    }
    try {
      await history.queue(() => coreRename(from, to));
    } catch (e) {
      setRenaming({ ...renaming, text, error: String(e) });
      return;
    }
    history.push({ label: "Rename Property", undo: () => coreRename(to, from), redo: () => coreRename(from, to) });
    setRenaming(null);
  }

  async function confirmDelete() {
    if (!deleting) return;
    const name = deleting;
    setDeleting(null);
    await deletePropertyNamed(name);
  }

  /** Deletes a property and its values from every file, recorded so it can be undone. */
  async function deletePropertyNamed(name: string) {
    const prop = propByName.get(name);
    const type = prop?.value_type ?? "free_text";
    const config = prop?.config ?? null;
    const values = (prop && registryValues[prop.property_id]?.map((v) => v.value)) || [];
    const before = snapshot(name);
    try {
      await history.queue(() => coreDelete(name));
    } catch (e) {
      setError(String(e));
      return;
    }
    history.push({
      label: "Delete Property",
      undo: async () => {
        // Recreate it as it was: type, options, registered values, then every file's value
        const restored = await createProperty(name, library, type, config);
        for (const v of values) await createPropertyValue(restored.property_id, v).catch(() => {});
        updateVisibleProperties((prev) => (prev.includes(name) ? prev : [...prev, name]));
        await restoreValues(before);
      },
      redo: () => coreDelete(name),
    });
  }

  function typeMenu(name: string): MenuEntry[] {
    const type = typeOf(name);
    const config = configOf(name);
    const format = type === "number" ? config.format ?? "generic" : null;
    const check = (text: string, checked: boolean, action: () => void): MenuEntry => ({ type: "check", text, checked, action });
    return [
      check("Text", type === "free_text", () => changeType(name, "free_text", null)),
      check("Number", format === "generic", () => changeType(name, "number", { format: "generic" })),
      {
        type: "submenu",
        text: "Currency",
        items: [...new Set([defaultCurrency(), ...CURRENCIES])].map((c) =>
          check(c, format === "currency" && config.currency === c, () => changeType(name, "number", { format: "currency", currency: c }))
        ),
      },
      check("Percentage", format === "percent", () => changeType(name, "number", { format: "percent" })),
      check("Date", type === "date", () => changeType(name, "date", null)),
      { type: "separator" },
      check("Select", type === "enum", () => changeType(name, "enum", null)),
      check("Multi-select", type === "array", () => changeType(name, "array", null)),
    ];
  }

  // Right-click on a header: actions for that column, then the column list
  function handleHeaderMenu(e: React.MouseEvent, columnId: string | null) {
    e.preventDefault();
    setPropertyMenu({ anchor: { x: e.clientX, y: e.clientY }, columnId });
  }

  function headerMenuEntries(columnId: string | null): MenuEntry[] {
    const col = columns.find((c) => c.id === columnId && c.id !== ADD_COLUMN.id);
    const entries: MenuEntry[] = [];
    if (col) {
      if (col.sortable !== false) {
        entries.push(
          { type: "item", text: "Sort Ascending", action: () => setSorts([{ key: col.id, direction: "asc" }]) },
          { type: "item", text: "Sort Descending", action: () => setSorts([{ key: col.id, direction: "desc" }]) },
          {
            type: "check",
            text: `Group by ${col.label}`,
            checked: groupLevels.some((g) => g.key === col.id),
            // Adds a level (inside any already there), or removes it
            action: () =>
              setGroupLevels((gs) =>
                gs.some((g) => g.key === col.id) ? gs.filter((g) => g.key !== col.id) : [...gs, { key: col.id, direction: defaultGroupDirection(col.id) }]
              ),
          }
        );
      }
      if (col.id === TAGS_COLUMN.id) {
        entries.push({ type: "check", text: "Hide Tags Recorded in Properties", checked: hideCovered, action: toggleHideCovered });
      }
      entries.push({
        type: "item",
        text: `Filter by ${col.label}…`,
        action: () => {
          setRules((rs) => [...rs, newRule(col.id, kindOf(col.id))]);
          setPanel("filter");
        },
      });
      if (col.id === TAGS_COLUMN.id) {
        entries.push(
          { type: "separator" },
          { type: "check", text: "Wrap Values", checked: wrapSourceTags, action: toggleWrapSourceTags }
        );
      }
      if (isEditable(col.id)) {
        const name = propName(col.id);
        entries.push(
          { type: "separator" },
          { type: "item", text: "Rename Property…", action: () => setRenaming({ name, text: name }) }
        );
        if (typeOf(name) === "enum" || typeOf(name) === "array") {
          entries.push({ type: "item", text: "Edit Values…", action: () => openValuesEditor(col.id) });
        }
        if (typeOf(name) === "array") {
          entries.push({ type: "check", text: "Wrap Values", checked: wraps(name), action: () => toggleWrap(name) });
        }
        // The built-in Tags property is always a Multi-select and can't be deleted
        if (name !== tagsProperty) {
          entries.push(
            { type: "submenu", text: "Property Type", items: typeMenu(name) },
            { type: "item", text: "Delete Property…", action: () => setDeleting(name) }
          );
        }
      }
      entries.push({ type: "separator" });
    }
    entries.push(
      { type: "check", text: "Freeze Name", checked: frozen, action: toggleFrozen },
      { type: "separator" },
      ...columnMenuEntries()
    );
    return entries;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  // Row heights: 20pt, or taller where a wrapping cell needs more lines
  const rowHeights = useMemo(() => {
    const wrapping = columns
      .filter((c) => c.id.startsWith(PROP_PREFIX) && isEditable(c.id) && wraps(propName(c.id)))
      .map((c) => ({ name: propName(c.id), width: (layout.widths[c.id] ?? 0) - CELL_PADDING }));
    const tagsWidth =
      wrapSourceTags && columns.some((c) => c.id === TAGS_COLUMN.id) ? (layout.widths[TAGS_COLUMN.id] ?? 0) - CELL_PADDING : null;
    if (wrapping.length === 0 && tagsWidth == null) return null;
    return sorted.map((f) => {
      // Only the tags shown count: hiding recorded ones shrinks the row
      let lines = tagsWidth == null ? 1 : pillLines(shownSourceTags(f), tagsWidth);
      for (const { name, width } of wrapping) lines = Math.max(lines, pillLines(listValues(metaValue(f, name)), width));
      return rowHeightFor(lines);
    });
  }, [columns, isEditable, wraps, wrapSourceTags, shownSourceTags, layout.widths, sorted]);
  const itemSize = useCallback(
    (i: number) => {
      const item = items[i];
      return item.type === "group" ? GROUP_HEIGHT : rowHeights?.[item.index] ?? ROW_HEIGHT;
    },
    [items, rowHeights]
  );
  // Each item's top, for finding the row under the pointer while dragging the fill handle
  const itemTops = useMemo(() => {
    const tops = new Array<number>(items.length);
    let y = 0;
    for (let i = 0; i < items.length; i++) {
      tops[i] = y;
      y += itemSize(i);
    }
    return tops;
  }, [items, itemSize]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => layout.container,
    estimateSize: itemSize,
    overscan: 10,
  });
  // Re-lay out the rows when wrapping changes their heights
  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [itemSize, rowVirtualizer]);

  // Rows: clicking a native cell (Name, Size…) selects the row, as in Finder
  const selection = useSelection(sorted, {
    reportStatus: false,
    arrowKeys: true,
    onReveal: (index) => rowVirtualizer.scrollToIndex(itemOfRow[index] ?? index),
  });

  // Cells: clicking a custom property cell selects just that cell
  const editableColumns = useMemo(() => columns.filter((c) => isEditable(c.id)).map((c) => c.id), [columns, isEditable]);
  const rowIds = useMemo(() => sorted.map((f) => f.file_id), [sorted]);
  const grid = useMemo(() => ({ rows: rowIds, cols: editableColumns }), [rowIds, editableColumns]);
  const rowIndex = useMemo(() => new Map(rowIds.map((id, i) => [id, i])), [rowIds]);
  const rowById = useMemo(() => new Map(sorted.map((f) => [f.file_id, f])), [sorted]);
  const [cellSel, setCellSel] = useState<CellSelection>(EMPTY_CELLS);
  useEffect(() => setCellSel((s) => pruneCells(s, grid)), [grid]);
  const solidRect = useMemo(() => isSolidRect(cellSel, grid), [cellSel, grid]);
  // Files selected (whole rows, or the rows that have a selected cell), shown in the count line
  const selectedFiles = useMemo(() => {
    if (cellSel.cells.size === 0) return sorted.filter((f) => selection.isSelected(f.file_id)).length;
    return new Set([...cellSel.cells].map((k) => parseCellKey(k).row)).size;
  }, [cellSel, sorted, selection]);

  const cellValue = useCallback(
    (row: string, col: string) => metaValue(rowById.get(row), propName(col)),
    [rowById]
  );

  const [editing, setEditing] = useState<{ ref: CellRef; seed?: string } | null>(null);
  const [editAnchor, setEditAnchor] = useState<HTMLElement | null>(null);
  const listMove = useRef<CommitMove>("none");

  /**
   * Keyboard focus while cells are selected: an offscreen text field, so the
   * OS's own Copy and Paste (menu and shortcuts) reach the table.
   */
  const sinkRef = useRef<HTMLTextAreaElement>(null);
  const clipboard = useRef<{ text: string; values: unknown[][] } | null>(null);
  const pasteHandled = useRef(false);
  const rowsRef = useRef<HTMLDivElement>(null);

  function focusSink() {
    const el = sinkRef.current;
    if (!el) return;
    el.value = " ";
    el.focus({ preventScroll: true });
    el.select();
  }

  function reveal(ref: CellRef | null) {
    const i = ref ? rowIndex.get(ref.row) : undefined;
    if (i != null) rowVirtualizer.scrollToIndex(itemOfRow[i] ?? i);
  }

  /**
   * Writes cell values: shown at once, saved in order with other changes.
   * With `select`, the cells become the selection (undo and redo show what changed).
   */
  async function applyEdits(edits: CellEdit[], { select = false, queued = true } = {}) {
    if (edits.length === 0) return;
    setPatches((prev) => {
      const next = new Map(prev);
      for (const e of edits) next.set(e.file_id, { ...next.get(e.file_id), [e.key]: e.value });
      return next;
    });
    if (select) {
      const refs = edits.map((e) => ({ row: e.file_id, col: PROP_PREFIX + e.key }));
      setCellSel({ cells: new Set(refs.map(cellKey)), anchor: refs[0], active: refs[0] });
      reveal(refs[0]);
      focusSink();
    }
    pendingWrites.current++;
    try {
      await (queued ? history.queue(() => setMetadataCells(edits)) : setMetadataCells(edits));
    } catch (e) {
      setError(String(e));
    } finally {
      pendingWrites.current--;
    }
    // New Select / Multi-select values may have been registered
    setRegistryValues({});
    if (pendingWrites.current === 0) {
      onChanged?.();
      loadKeys();
    }
  }

  /** A user's edit, fill, paste or clear: written, and recorded so it can be undone. */
  async function writeCells(writes: CellWrite[], label = "Edit") {
    const edits = writes.flatMap((w) => {
      const name = propName(w.col);
      if (EXTRACTED_KEYS.has(name)) return [];
      const value = coerceValue(w.value, typeOf(name), configOf(name));
      return sameValue(value, cellValue(w.row, w.col)) ? [] : [{ file_id: w.row, key: name, value }];
    });
    await writeEdits(edits, label);
  }

  /** Writes values exactly as given (already fit for their columns), recorded so they can be undone. */
  async function writeEdits(edits: CellEdit[], label: string) {
    if (edits.length === 0) return;
    const previous = edits.map((e) => ({ ...e, value: cellValue(e.file_id, PROP_PREFIX + e.key) }));
    history.push({
      label,
      undo: () => applyEdits(previous, { select: true, queued: false }),
      redo: () => applyEdits(edits, { select: true, queued: false }),
    });
    await applyEdits(edits);
  }

  function onCellClick(e: React.MouseEvent, ref: CellRef) {
    e.stopPropagation();
    if (e.detail > 1) return;
    selection.clear();
    setCellSel((s) => clickCell(s, ref, { toggle: isToggleSelect(e), range: e.shiftKey }, grid));
    focusSink();
  }

  function startEdit(ref: CellRef, seed?: string) {
    setCellSel({ cells: new Set([cellKey(ref)]), anchor: ref, active: ref });
    setEditing({ ref, seed });
    reveal(ref);
  }

  function endEdit(move: CommitMove) {
    setEditing(null);
    setEditAnchor(null);
    if (move !== "none") {
      const [dr, dc] = MOVES[move];
      setCellSel((s) => moveCell(s, dr, dc, false, grid));
    }
    requestAnimationFrame(focusSink);
  }

  function copyCells() {
    const values = copyGrid(cellSel, grid, cellValue);
    const text = toTsv(values.map((line) => line.map(valueToText)));
    clipboard.current = { text, values };
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function pasteValues(values: unknown[][]) {
    const writes = pasteWrites(values, cellSel, grid);
    writeCells(writes, "Paste");
    // A pasted block becomes the selection, as in a spreadsheet
    if (values.length > 1 || (values[0]?.length ?? 0) > 1) {
      const first = writes[0];
      const last = writes[writes.length - 1];
      if (first && last) {
        setCellSel({ cells: new Set(rectCells(first, last, grid).map(cellKey)), anchor: first, active: first });
      }
    }
  }

  function onTableKeyDown(e: React.KeyboardEvent) {
    if (editing) return;
    const active = cellSel.active;
    if (cellSel.cells.size === 0 || !active) {
      selection.onKeyDown(e);
      return;
    }
    const mod = hasPrimaryModifier(e);
    if (ARROWS[e.key] && !mod) {
      e.preventDefault();
      const [dr, dc] = ARROWS[e.key];
      const next = moveCell(cellSel, dr, dc, e.shiftKey, grid);
      setCellSel(next);
      reveal(next.active);
    } else if (e.key === "Tab") {
      e.preventDefault();
      setCellSel(moveCell(cellSel, 0, e.shiftKey ? -1 : 1, false, grid));
    } else if (e.key === "Enter") {
      e.preventDefault();
      startEdit(active);
    } else if (e.key === "Escape") {
      setCellSel(EMPTY_CELLS);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      writeCells([...cellSel.cells].map((k) => ({ ...parseCellKey(k), value: null })), "Clear");
    } else if (mod && e.key === "a") {
      e.preventDefault();
      const all = rectCells({ row: grid.rows[0], col: grid.cols[0] }, { row: grid.rows[grid.rows.length - 1], col: grid.cols[grid.cols.length - 1] }, grid);
      setCellSel({ cells: new Set(all.map(cellKey)), anchor: all[0], active: active });
    } else if (mod && e.key === "c") {
      // The copy event that follows puts the same text on the clipboard
      copyCells();
    } else if (mod && e.key === "v") {
      // Normally the paste event delivers the clipboard; fall back to our own copy
      pasteHandled.current = false;
      window.setTimeout(() => {
        if (!pasteHandled.current && clipboard.current) pasteValues(clipboard.current.values);
      }, 60);
    } else if (!mod && !e.altKey && e.key.length === 1) {
      // Typing into a selected cell replaces its value
      e.preventDefault();
      startEdit(active, e.key);
    }
  }

  // Edit ▸ Undo / Redo (and their shortcuts) reach this view's history while it's shown
  const { undo, redo } = history;
  useEffect(() => setUndoTarget({ undo, redo }), [undo, redo]);
  useEffect(() => () => void setEditMenuLabels(null, null).catch(() => {}), []);

  // ── Fill handle ───────────────────────────────────────────────────────────

  const [fillTo, setFillTo] = useState<number | null>(null);

  function startFill(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = solidRect;
    const container = layout.container;
    const body = rowsRef.current;
    if (!rect || !container || !body) return;
    const fillGrid = grid;
    let target = rect.r1;
    let lastY = e.clientY;
    let frame = 0;

    const rowAt = (clientY: number) => {
      const y = clientY - body.getBoundingClientRect().top;
      // Over a group heading, the row just after it (or the last row, past the end)
      let item = rowAtOffset(itemTops, y);
      while (item < items.length && items[item].type === "group") item++;
      const at = items[item];
      const index = at?.type === "row" ? at.index : fillGrid.rows.length - 1;
      return Math.max(0, Math.min(fillGrid.rows.length - 1, index));
    };
    const update = () => {
      target = rowAt(lastY);
      setFillTo(target);
    };
    // Dragging past the top or bottom edge scrolls, faster the further out
    const tick = () => {
      const r = container.getBoundingClientRect();
      const top = r.top + 28;
      const edge = 20;
      const dy = lastY < top + edge ? -(top + edge - lastY) / 3 : lastY > r.bottom - edge ? (lastY - r.bottom + edge) / 3 : 0;
      if (dy) {
        container.scrollTop += dy;
        update();
      }
      frame = requestAnimationFrame(tick);
    };
    const onMove = (ev: MouseEvent) => {
      lastY = ev.clientY;
      update();
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      // The click that ends the drag would land on the table and clear the selection
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      setFillTo(null);
      const writes = fillWrites(rect, target, fillGrid, cellValue);
      if (writes.length > 0) {
        writeCells(writes, "Fill");
        const from = { row: fillGrid.rows[Math.min(rect.r0, target)], col: fillGrid.cols[rect.c0] };
        const to = { row: fillGrid.rows[Math.max(rect.r1, target)], col: fillGrid.cols[rect.c1] };
        const anchor = { row: fillGrid.rows[rect.r0], col: fillGrid.cols[rect.c0] };
        setCellSel({ cells: new Set(rectCells(from, to, fillGrid).map(cellKey)), anchor, active: anchor });
      }
      focusSink();
    };
    document.body.style.cursor = "crosshair";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    frame = requestAnimationFrame(tick);
  }

  /** Rows the fill handle is being dragged over. */
  const fillRows =
    fillTo != null && solidRect
      ? fillTo > solidRect.r1
        ? [solidRect.r1 + 1, fillTo]
        : fillTo < solidRect.r0
          ? [fillTo, solidRect.r0 - 1]
          : null
      : null;

  // ── Dragging tags onto columns ────────────────────────────────────────────

  // A source tag (folder name) dropped on a list column maps every folder with
  // that name to the property; a hand-added tag moves out of Tags into it.
  // The column must be hovered for DROP_DWELL_MS before a release drops there.

  const [tagDrag, setTagDrag] = useState<TagDrag | null>(null);
  const { confirm: confirmOverwrite, dialog: overwriteDialog } = useOverwriteConfirm();

  function columnBoxes() {
    return columns.map((c) => ({ id: c.id, width: layout.widths[c.id] ?? 0 }));
  }

  /** The column under a point in the window, or null outside the table. */
  function columnAtPoint(x: number, y: number): string | null {
    const container = layout.container;
    if (!container) return null;
    const r = container.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const visual = x - r.left - INSET;
    // The frozen Name column stays put while the rest scroll under it
    if (frozenId && visual >= 0 && visual < (layout.widths[frozenId] ?? 0)) return frozenId;
    return columnAtOffset(visual + container.scrollLeft, columnBoxes());
  }

  /** Select and Multi-select property columns take a dropped tag, as does "+" (a new Multi-select). */
  function canDropTag(columnId: string | null, source: TagSource): boolean {
    if (!columnId) return false;
    if (columnId === ADD_COLUMN.id) return true;
    if (!isEditable(columnId)) return false;
    const name = propName(columnId);
    const type = typeOf(name);
    if (type !== "enum" && type !== "array") return false;
    // Anywhere but the column it came from
    return source === "source" || name !== source.property;
  }

  function startTagDrag(e: React.MouseEvent, value: string, source: TagSource) {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    // The pressed pill shows in the accent colour until the press ends
    const pill = e.currentTarget as HTMLElement;
    pill.dataset.pressed = "";
    const container = layout.container;
    const start = { x: e.clientX, y: e.clientY };
    let last = start;
    let started = false;
    let target: string | null = null;
    let armed = false;
    let timer = 0;
    let frame = 0;

    const show = () => setTagDrag({ value, source, x: last.x, y: last.y, target, armed });
    const retarget = () => {
      const col = columnAtPoint(last.x, last.y);
      const next = canDropTag(col, source) ? col : null;
      if (next !== target) {
        window.clearTimeout(timer);
        target = next;
        armed = false;
        if (next) {
          timer = window.setTimeout(() => {
            armed = true;
            show();
          }, DROP_DWELL_MS);
        }
      }
      show();
    };
    // Holding near the left or right edge scrolls the table across
    const tick = () => {
      if (container) {
        const r = container.getBoundingClientRect();
        const edge = 40;
        const dx =
          last.x < r.left + edge ? -(r.left + edge - last.x) / 3 : last.x > r.right - edge ? (last.x - r.right + edge) / 3 : 0;
        if (dx && last.y >= r.top && last.y <= r.bottom) {
          container.scrollLeft += dx;
          retarget();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    const onMove = (ev: MouseEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!started) {
        if (Math.hypot(last.x - start.x, last.y - start.y) < DRAG_THRESHOLD) return;
        started = true;
        frame = requestAnimationFrame(tick);
      }
      retarget();
    };
    const finish = (drop: boolean) => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey, true);
      delete pill.dataset.pressed;
      setTagDrag(null);
      if (!started) return;
      // The click that ends the drag would land on the table and change the selection
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      if (drop && target && armed) void dropTag(value, source, target);
    };
    const onUp = () => finish(true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey, true);
  }

  async function dropTag(value: string, source: TagSource, columnId: string) {
    let name: string;
    let type: ValueType;
    if (columnId === ADD_COLUMN.id) {
      const added = await addProperty("Multi-select", "array", null);
      if (!added) return;
      name = added;
      type = "array";
    } else {
      name = propName(columnId);
      type = typeOf(name);
    }
    try {
      if (source === "source") await mapTag(value, name, type);
      else await moveValue(value, source.property, name, type);
    } catch (e) {
      setError(String(e));
    }
  }

  /**
   * Source tag → column: maps every folder with that name to the property, so it
   * holds on every refresh. The tag stays (source tags never change) and shows as covered.
   */
  async function mapTag(value: string, name: string, type: ValueType) {
    const folders = await foldersNamed(locationId, value);
    if (folders.length === 0) return;
    let overwrite = false;
    if (type === "enum") {
      const conflicts = await countMappingConflicts(locationId, folders, name);
      if (conflicts > 0) {
        if (!(await confirmOverwrite(name, conflicts))) return;
        overwrite = true;
      }
    }
    const previous = (await getMappingNodes(locationId)).filter((n) => folders.includes(n.folder_path));
    const before = snapshot(name);
    const apply = async () => {
      await setFolderLabels(locationId, folders, name, overwrite);
      setHasMappings(true);
      await afterPropertyChange();
    };
    await history.queue(apply);
    history.push({
      label: "Map Tag",
      undo: async () => {
        // Put each folder's mapping back as it was, then the values it replaced
        const unmapped = folders.filter((f) => !previous.some((n) => n.folder_path === f));
        if (unmapped.length > 0) await clearFolderLabels(locationId, unmapped);
        for (const n of previous) await setFolderLabels(locationId, [n.folder_path], n.property_name);
        await restoreValues(before);
        setHasMappings((await getMappingNodes(locationId)).length > 0);
      },
      redo: apply,
    });
  }

  /**
   * Property value → another list column: moves it on every file that has it.
   * A value that comes from mapped folders moves their mapping too (and its
   * rename link), so refreshes keep it in its new property.
   */
  async function moveValue(value: string, from: string, to: string, type: ValueType) {
    const affected = rows.filter((f) => listValues(metaValue(f, from)).includes(value));
    if (affected.length === 0) return;
    let overwrite = false;
    if (type === "enum") {
      const conflicts = affected.filter((f) => {
        const current = metaValue(f, to);
        return current != null && valueToText(current) !== value;
      }).length;
      if (conflicts > 0) {
        if (!(await confirmOverwrite(to, conflicts))) return;
        overwrite = true;
      }
    }
    // Both columns as they were, for undo
    const before = [...snapshot(from), ...snapshot(to)];
    const apply = async () => {
      await movePropertyValue(locationId, value, from, to, overwrite);
      await afterPropertyChange();
    };
    await history.queue(apply);
    history.push({
      label: "Move Value",
      undo: async () => {
        await movePropertyValue(locationId, value, to, from, true);
        await restoreValues(before);
        setHasMappings((await getMappingNodes(locationId)).length > 0);
      },
      redo: apply,
    });
  }

  /** "Move “Acme” to Client · 14 files, 2 folders", shown once a hovered column will take the drop. */
  function dropHint(d: TagDrag): string {
    if (!d.target) return "";
    const into = d.target === ADD_COLUMN.id ? "a new Multi-select" : propName(d.target);
    const count = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
    if (d.source === "source") {
      const files = rows.filter((f) => Array.isArray(f.tags) && f.tags.includes(d.value)).length;
      const folders = countFoldersNamed(rows.map((f) => f.relative_path), d.value);
      return `Move “${d.value}” to ${into} · ${count(files, "file")}, ${count(folders, "folder")}`;
    }
    const from = d.source.property;
    const files = rows.filter((f) => listValues(metaValue(f, from)).includes(d.value)).length;
    return `Move “${d.value}” to ${into} · ${count(files, "file")}`;
  }

  /** The hovered column's box in the window, for the drop highlight. */
  function dropBox(columnId: string): { left: number; top: number; width: number; height: number } | null {
    const container = layout.container;
    if (!container) return null;
    const r = container.getBoundingClientRect();
    const left = r.left + INSET + columnOffset(columnId, columnBoxes()) - container.scrollLeft;
    const right = Math.min(r.right, left + (layout.widths[columnId] ?? 0));
    const clipped = Math.max(r.left, left);
    return { left: clipped, top: r.top, width: Math.max(0, right - clipped), height: r.height };
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  const frozenId = frozen ? "name" : null;
  const extraColCount = (showTags ? 1 : 0) + shownProperties.length;

  function renderPropertyCell(col: ColumnDef, file: FileRecord, rowIdx: number) {
    const style = cellBoxStyle(layout.widths[col.id], layout.phaseOf(col.id));
    const name = propName(col.id);
    const value = metaValue(file, name);
    const type = typeOf(name);
    const config = configOf(name);
    const align = col.align === "right" ? "text-right justify-end" : "";

    if (!isEditable(col.id)) {
      return (
        <div key={col.id} style={style} className={`${CELL} ${align} ${value != null ? "text-neutral-400" : "text-neutral-500"}`}>
          {value != null ? formatValue(value, type, config) : "—"}
        </div>
      );
    }

    const ref = { row: file.file_id, col: col.id };
    const key = cellKey(ref);
    const selected = cellSel.cells.has(key);
    const isEditing = editing?.ref.row === ref.row && editing.ref.col === ref.col;
    const colIdx = grid.cols.indexOf(col.id);
    const inFill =
      fillRows != null && solidRect != null && rowIdx >= fillRows[0] && rowIdx <= fillRows[1] && colIdx >= solidRect.c0 && colIdx <= solidRect.c1;
    const isActive = selected && cellSel.cells.size > 1 && cellSel.active?.row === ref.row && cellSel.active.col === ref.col;
    const showHandle = !editing && solidRect != null && rowIdx === solidRect.r1 && colIdx === solidRect.c1;
    const isList = type === "enum" || type === "array";
    // The selection is outlined as one shape: each cell draws only the edges its
    // neighbours (in the same column, or the columns either side) don't share
    const pos = columns.findIndex((c) => c.id === col.id);
    const selectedAt = (row: string | undefined, column: string | undefined) =>
      row != null && column != null && cellSel.cells.has(cellKey({ row, col: column }));
    const frame = selected
      ? {
          top: !selectedAt(grid.rows[rowIdx - 1], col.id),
          bottom: !selectedAt(grid.rows[rowIdx + 1], col.id),
          left: !selectedAt(ref.row, columns[pos - 1]?.id),
          right: !selectedAt(ref.row, columns[pos + 1]?.id),
        }
      : inFill && fillRows && solidRect
        ? {
            top: rowIdx === fillRows[0],
            bottom: rowIdx === fillRows[1],
            left: colIdx === solidRect.c0,
            right: colIdx === solidRect.c1,
          }
        : null;

    return (
      <div
        key={col.id}
        ref={isEditing ? setEditAnchor : undefined}
        style={style}
        onClick={(e) => onCellClick(e, ref)}
        // Right-click anywhere in the column: the column's menu (Edit Values…, type, wrap…)
        onContextMenu={(e) => {
          e.stopPropagation();
          handleHeaderMenu(e, col.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEdit(ref);
        }}
        // No overflow clipping here, so the fill handle can sit over the corner
        className={`shrink-0 px-3 whitespace-nowrap relative self-stretch flex items-center ${align} ${
          isActive ? "bg-blue-500/10" : ""
        }`}
      >
        <div className={`min-w-0 flex-1 flex items-center overflow-hidden ${align}`}>
          {isEditing && !isList ? (
            <TextCellEditor
              initial={editing.seed ?? editText(value, type, config)}
              type={type}
              onCommit={(text, move) => {
                writeCells([{ row: ref.row, col: ref.col, value: parseInput(text, type, config) }]);
                endEdit(move);
              }}
              onCancel={() => endEdit("none")}
            />
          ) : (
            <PropertyValueView
              value={value}
              type={type}
              config={config}
              // Any Select / Multi-select value can be dragged onto another list column
              onPillMouseDown={isList ? (e, v) => startTagDrag(e, v, { property: name }) : undefined}
              wrap={isList && wraps(name)}
            />
          )}
        </div>
        {frame && <SelectionFrame edges={frame} dashed={!selected} />}
        {showHandle && (
          <div
            title="Drag to fill"
            onMouseDown={startFill}
            onClick={(e) => e.stopPropagation()}
            className="absolute -right-[4px] -bottom-[4px] z-[3] w-[8px] h-[8px] rounded-full bg-blue-500 ring-[1.5px] ring-neutral-900 cursor-crosshair"
          />
        )}
      </div>
    );
  }

  function renderCell(col: ColumnDef, file: FileRecord, rowIdx: number, rowSelected: boolean) {
    if (col.id.startsWith(PROP_PREFIX)) return renderPropertyCell(col, file, rowIdx);
    const style = cellBoxStyle(layout.widths[col.id], layout.phaseOf(col.id));
    switch (col.id) {
      case "name": {
        const isFrozen = frozenId === "name";
        return (
          <div
            key={col.id}
            style={
              isFrozen
                ? {
                    ...style,
                    position: "sticky",
                    left: INSET,
                    zIndex: 1,
                    // Covers the inset strip beside it, plus a hairline edge once scrolled across
                    boxShadow: `-${INSET}px 0 0 var(--n-900)${scrolledX ? ", 1px 0 0 var(--n-700)" : ""}`,
                  }
                : style
            }
            className={`shrink-0 self-stretch px-3 whitespace-nowrap overflow-visible flex items-center gap-1.5 text-neutral-100 ${
              isFrozen ? `rounded-l-md ${rowSelected ? "native-selected" : rowIdx % 2 === 1 ? "bg-neutral-850" : "bg-neutral-900"}` : ""
            }`}
          >
            <FileIcon path={file.file_path} mimeType={file.file_type} size={16} />
            <span className="truncate min-w-0">{fileName(file.file_path)}</span>
            <CloudBadge show={file.online_only} className="ml-auto" />
          </div>
        );
      }
      case "ext":
        return <div key={col.id} style={style} className={`${CELL} text-neutral-400`}>{fileExtension(file.file_path)}</div>;
      case "path":
        return (
          <div key={col.id} style={style} className={`${CELL} text-neutral-400`} title={file.relative_path ?? file.file_path}>
            {file.relative_path ?? file.file_path}
          </div>
        );
      case "type":
        return <div key={col.id} style={style} className={`${CELL} text-neutral-400`}>{kindCategory(file)}</div>;
      case "size":
        return <div key={col.id} style={style} className={`${CELL} text-right text-neutral-400`}>{formatFinderSize(file.file_size)}</div>;
      case "created":
        return <div key={col.id} style={style} className={`${CELL} text-neutral-400`}>{formatFinderDate(file.timestamp)}</div>;
      case "modified":
        return <div key={col.id} style={style} className={`${CELL} text-neutral-400`}>{formatFinderDate(file.modified_at)}</div>;
      case "tags":
        return (
          <div key={col.id} style={style} className={`${CELL} flex items-center`}>
            <TagPills
              tags={shownSourceTags(file)}
              covered={coveredFor(file)}
              onPillMouseDown={(e, tag) => startTagDrag(e, tag, "source")}
              wrap={wrapSourceTags}
            />
          </div>
        );
      default:
        return <div key={col.id} style={style} className="shrink-0" />;
    }
  }

  const filterColumns: FilterColumn[] = useMemo(
    () =>
      [
        ...STANDARD_COLUMNS,
        TAGS_COLUMN,
        ...availableProperties.map((name) => propertyColumn(name, typeOf(name))),
      ].map((c) => ({ id: c.id, label: c.label, kind: kindOf(c.id) })),
    [availableProperties, typeOf, kindOf]
  );

  /** Opens Edit Values… for a list column, below its header. */
  function openValuesEditor(columnId: string) {
    const header = layout.container?.querySelector<HTMLElement>(`[data-column-id="${CSS.escape(columnId)}"]`);
    const anchor = header ?? layout.container;
    if (anchor) setValuesEditor({ columnId, anchor });
  }

  /** Folder names a list value was renamed from, shown greyed beside it. */
  function sourcesOf(columnId: string, value: string): string[] {
    const prop = propByName.get(propName(columnId));
    return (prop && registryValues[prop.property_id]?.find((v) => v.value === value)?.sources) || [];
  }

  async function coreRenameValue(name: string, from: string, to: string) {
    const prop = await ensureProperty(name);
    await renamePropertyValue(prop.property_id, from, to);
    await afterPropertyChange();
  }

  /**
   * Renames a list value in the property and every file that has it. A value
   * that came from a folder keeps that link, so refreshes write the new name.
   */
  async function renameListValue(columnId: string, from: string, to: string) {
    const name = propName(columnId);
    // Renaming onto an existing value merges them; undo then puts each file's values back
    const merging = valuesFor(columnId).includes(to);
    const before = snapshot(name).filter((e) => listValues(e.value).some((v) => v === from || v === to));
    try {
      await history.queue(() => coreRenameValue(name, from, to));
    } catch (e) {
      setError(String(e));
      return;
    }
    history.push({
      label: "Rename Value",
      undo: merging
        ? async () => {
            const prop = await ensureProperty(name);
            await createPropertyValue(prop.property_id, from).catch(() => {});
            await restoreValues(before);
          }
        : () => coreRenameValue(name, to, from),
      redo: () => coreRenameValue(name, from, to),
    });
  }

  async function coreAddValue(name: string, value: string) {
    const prop = await ensureProperty(name);
    await createPropertyValue(prop.property_id, value);
    await afterPropertyChange();
  }

  /** Adds a value to a list property's options without putting it on any file. */
  async function addListValue(columnId: string, value: string) {
    const name = propName(columnId);
    try {
      await history.queue(() => coreAddValue(name, value));
    } catch (e) {
      setError(String(e));
      return;
    }
    history.push({
      label: "Add Value",
      undo: () => coreDeleteValue(name, value),
      redo: () => coreAddValue(name, value),
    });
  }

  /** Removes a Select / Multi-select value from the property and from every file that has it. */
  async function coreDeleteValue(name: string, value: string) {
    const prop = await ensureProperty(name);
    const record =
      (await getPropertyValues(prop.property_id)).find((v) => v.value === value) ??
      // A value found only on files: register it so it can be deleted
      (await createPropertyValue(prop.property_id, value));
    await deletePropertyValue(record.value_id);
    await afterPropertyChange();
  }

  /** Removes a Select / Multi-select value from the property and from every file that has it. */
  async function deleteListValue(columnId: string, value: string) {
    const name = propName(columnId);
    const before = snapshot(name).filter((e) => listValues(e.value).includes(value));
    try {
      await history.queue(() => coreDeleteValue(name, value));
    } catch (e) {
      setError(String(e));
      return;
    }
    history.push({
      label: "Delete Value",
      undo: async () => {
        const prop = await ensureProperty(name);
        await createPropertyValue(prop.property_id, value).catch(() => {});
        await restoreValues(before);
      },
      redo: () => coreDeleteValue(name, value),
    });
  }

  /** How many files in this location have `value` in a list column. */
  function valueUsage(columnId: string, value: string): number {
    const name = propName(columnId);
    return rows.filter((f) => listValues(metaValue(f, name)).includes(value)).length;
  }

  /** Values offered for a list column: registered ones and any already on files. */
  function valuesFor(columnId: string): string[] {
    const set = new Set<string>();
    if (columnId === TAGS_COLUMN.id) {
      for (const f of rows) for (const t of Array.isArray(f.tags) ? f.tags : []) set.add(t);
    } else if (NATIVE_KINDS[columnId] === "list") {
      // Ext and Kind: pick from the values the files have
      for (const f of rows) for (const v of listValues(nativeValue(f, columnId))) set.add(v);
    } else if (columnId.startsWith(PROP_PREFIX)) {
      const name = propName(columnId);
      const prop = propByName.get(name);
      for (const v of (prop && registryValues[prop.property_id]) || []) set.add(v.value);
      for (const f of rows) for (const v of listValues(metaValue(f, name))) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  const editingList =
    editing && editAnchor && (typeOf(propName(editing.ref.col)) === "enum" || typeOf(propName(editing.ref.col)) === "array")
      ? editing
      : null;
  const activeRules = rules.filter((r) => r.op === "empty" || r.op === "not_empty" || r.value.trim() !== "");

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-700/60 shrink-0">
        <span className="flex-1 min-w-0 truncate whitespace-nowrap text-neutral-500 text-xs">
          {/* The table's own count line carries the selection, rather than the toolbar */}
          {selectionLabel({ selected: selectedFiles, total: matched.length }) ??
            (matched.length === rows.length
              ? `${matched.length.toLocaleString()} files`
              : `${matched.length.toLocaleString()} of ${rows.length.toLocaleString()} files`)}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            ref={filterButtonRef}
            onClick={() => setPanel((p) => (p === "filter" ? null : "filter"))}
            className={`${TOOLBAR_BUTTON} flex items-center gap-1 ${activeRules.length > 0 ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON_IDLE}`}
          >
            <SymbolIcon name="line.3.horizontal.decrease" size={11} fallback="≡" />
            {activeRules.length > 0 ? `Filter (${activeRules.length})` : "Filter"}
          </button>
          <button
            ref={sortButtonRef}
            onClick={() => setPanel((p) => (p === "sort" ? null : "sort"))}
            className={`${TOOLBAR_BUTTON} flex items-center gap-1 ${sorts.length > 1 ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON_IDLE}`}
          >
            <SymbolIcon name="arrow.up.arrow.down" size={11} fallback="↕" />
            {sorts.length > 1 ? `Sort (${sorts.length})` : "Sort"}
          </button>
          <button
            ref={groupButtonRef}
            onClick={() => setPanel((p) => (p === "group" ? null : "group"))}
            className={`${TOOLBAR_BUTTON} flex items-center gap-1 ${groupLevels.length > 0 ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON_IDLE}`}
          >
            <SymbolIcon name="square.grid.3x2" size={11} fallback="▦" />
            {groupLevels.length > 0 ? `Group (${groupLevels.length})` : "Group"}
          </button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files…"
          className="min-w-[120px] px-3 py-1 bg-neutral-800 border border-neutral-700 rounded-md text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
          style={{ flex: "0 1 208px" }}
        />
        <OverflowBar
          items={[
            {
              id: "map",
              node: (
                <button
                  onClick={() => openStructureMapping(locationId)}
                  className={`${TOOLBAR_BUTTON} ${hasMappings ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON_IDLE}`}
                >
                  {hasMappings ? "● Map Structure" : "Map Structure"}
                </button>
              ),
              menu: [{ type: "item", text: "Map Structure…", action: () => openStructureMapping(locationId) }],
            },
            {
              id: "columns",
              node: (
                <button
                  onClick={(e) => {
                    const button = e.currentTarget;
                    setPropertyMenu((open) => (open ? null : { anchor: button }));
                  }}
                  className={`${TOOLBAR_BUTTON} ${extraColCount > 0 ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON_IDLE}`}
                >
                  {extraColCount > 0 ? `Properties (${extraColCount})` : "Properties"}
                </button>
              ),
              menu: [{ type: "submenu", text: "Properties", items: columnMenuEntries() }],
            },
          ]}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-950/40 text-red-400 text-xs border-b border-red-900/40 shrink-0">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-red-200">
            Dismiss
          </button>
        </div>
      )}
      {indexing && !indexing.done && (
        <div className="px-4 py-2 bg-blue-950/40 text-blue-300 text-xs border-b border-blue-900/40 shrink-0">
          Refreshing… {indexing.scanned.toLocaleString()} files read
        </div>
      )}
      {indexing && indexing.done && (
        <div className="px-4 py-2 bg-green-950/40 text-green-300 text-xs border-b border-green-900/40 shrink-0">
          {indexing.summary ? `Refreshed: ${describeRefresh(indexing.summary)}` : "Refreshed"}
        </div>
      )}

      {/* Table: one scroll container, sticky header, virtualised rows */}
      <div
        ref={layout.setContainer}
        tabIndex={0}
        onKeyDown={onTableKeyDown}
        onScroll={(e) => {
          const x = e.currentTarget.scrollLeft > 0;
          if (x !== scrolledX) setScrolledX(x);
        }}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("[data-table-header]")) {
            selection.clear();
            setCellSel(EMPTY_CELLS);
          }
        }}
        className="flex-1 min-h-0 overflow-auto outline-none"
      >
        <TableHeader
          columns={columns}
          widths={layout.widths}
          contentWidth={layout.contentWidth}
          sort={sorts[0] ?? null}
          onSort={(key) => {
            sortsBeforeClick.current = sorts;
            setSorts((s) => cycleSort(s, key));
          }}
          onHeaderDoubleClick={(columnId) => {
            if (!isEditable(columnId)) return;
            // The double-click's first click sorted; put the order back
            if (sortsBeforeClick.current) setSorts(sortsBeforeClick.current);
            const name = propName(columnId);
            setRenaming({ name, text: name });
          }}
          onResizeStart={layout.startResize}
          onResetColumn={layout.resetColumn}
          onContextMenu={handleHeaderMenu}
          onReorder={handleReorder}
          inset={INSET}
          phaseOf={layout.phaseOf}
          frozenColumnId={frozenId}
          frozenEdge={scrolledX}
          renderLabel={(col) =>
            renaming && col.id === PROP_PREFIX + renaming.name ? (
              <HeaderNameEditor
                key={renaming.error ?? ""}
                initial={renaming.text}
                error={renaming.error}
                onCommit={submitRename}
                onCancel={() => setRenaming(null)}
              />
            ) : col.id === ADD_COLUMN.id ? (
              <span className="-ml-1.5 flex items-center gap-0.5">
                <button
                  title="Add Property"
                  aria-label="Add Property"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    showAddMenu(e);
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded-[5px] text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/60"
                >
                  <SymbolIcon name="plus" size={12} fallback="+" />
                </button>
                <button
                  title="Show or Hide Properties"
                  aria-label="Show or Hide Properties"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    const button = e.currentTarget;
                    setPropertyMenu((open) => (open ? null : { anchor: button }));
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded-[5px] text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/60"
                >
                  <SymbolIcon name="ellipsis" size={12} fallback="…" />
                </button>
              </span>
            ) : undefined
          }
        />
        {matched.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-neutral-500 text-sm">
            {files.length === 0
              ? indexing && !indexing.done
                ? "Indexing…"
                : "No files indexed yet. Refresh the location from the sidebar."
              : "No files match your search or filters"}
          </div>
        ) : (
          <div style={{ paddingLeft: INSET, paddingRight: INSET }}>
            <div
              ref={rowsRef}
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: layout.contentWidth,
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index];
                if (item.type === "group") {
                  const { group } = item;
                  return (
                    <div
                      key={`group:${group.id}`}
                      role="button"
                      aria-expanded={!item.collapsed}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Option-click opens or closes every group at this level, as with Finder's disclosure triangles
                        if (groups) setCollapsed(toggleCollapsed(collapsed, group, groups, e.altKey));
                      }}
                      onContextMenu={(e) => showGroupMenu(e, group, item.collapsed)}
                      className="flex items-end cursor-default select-none"
                    >
                      {/* Stays in view when the table scrolls sideways */}
                      <div
                        className="sticky flex items-center gap-1 h-[22px] pr-2 text-body"
                        style={{ left: INSET, paddingLeft: group.depth * GROUP_INDENT }}
                      >
                        <SymbolIcon
                          name="chevron.right"
                          size={10}
                          fallback="›"
                          className={`w-4 text-neutral-500 transition-transform duration-150 ${item.collapsed ? "" : "rotate-90"}`}
                        />
                        <span className="font-semibold text-neutral-100 truncate max-w-[480px]">{group.label}</span>
                        <span className="text-neutral-500 tabular-nums">{group.count.toLocaleString()}</span>
                      </div>
                    </div>
                  );
                }
                const file = item.row;
                const rowIdx = item.index;
                const isSelected = selection.isSelected(file.file_id);
                // Adjacent selected rows join into one block, as in Finder (not across a group heading)
                const prev = items[virtualRow.index - 1];
                const next = items[virtualRow.index + 1];
                const joinsAbove = isSelected && prev?.type === "row" && selection.isSelected(prev.row.file_id);
                const joinsBelow = isSelected && next?.type === "row" && selection.isSelected(next.row.file_id);
                return (
                  <div
                    key={file.file_id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                      // Lift the row with the fill handle so the handle overlaps the row below
                      zIndex: !editing && solidRect?.r1 === rowIdx ? 2 : undefined,
                    }}
                    onClick={(e) => {
                      setCellSel(EMPTY_CELLS);
                      selection.onItemClick(e, file.file_id);
                    }}
                    onDoubleClick={(e) => selection.onItemDoubleClick(e, file.file_id)}
                    className={`flex items-center rounded-md text-body cursor-default ${
                      joinsAbove ? "rounded-t-none" : ""
                    } ${joinsBelow ? "rounded-b-none" : ""} ${
                      isSelected
                        ? "native-selected"
                        : item.stripe % 2 === 1
                          ? "bg-neutral-850"
                          : ""
                    }`}
                  >
                    {columns.map((col) => renderCell(col, file, rowIdx, isSelected))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <textarea
        ref={sinkRef}
        data-edit-sink
        aria-hidden
        tabIndex={-1}
        onKeyDown={onTableKeyDown}
        onCopy={(e) => {
          if (!clipboard.current) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", clipboard.current.text);
        }}
        onPaste={(e) => {
          e.preventDefault();
          pasteHandled.current = true;
          const text = e.clipboardData.getData("text/plain");
          const internal = clipboard.current;
          pasteValues(internal && internal.text === text ? internal.values : parseTsv(text));
        }}
        onInput={(e) => {
          e.currentTarget.value = " ";
        }}
        className="fixed -left-50 top-0 w-px h-px opacity-0 pointer-events-none"
      />

      {editingList && editAnchor && (
        <ListCellEditor
          anchor={editAnchor}
          value={cellValue(editingList.ref.row, editingList.ref.col)}
          multiple={typeOf(propName(editingList.ref.col)) === "array"}
          options={valuesFor(editingList.ref.col)}
          seed={editingList.seed}
          onDeleteValue={(value) => deleteListValue(editingList.ref.col, value)}
          onRenameValue={(from, to) => renameListValue(editingList.ref.col, from, to)}
          sourcesOf={(value) => sourcesOf(editingList.ref.col, value)}
          usage={(value) => valueUsage(editingList.ref.col, value)}
          onPreview={(value) => {
            const name = propName(editingList.ref.col);
            setListPreview({ file_id: editingList.ref.row, key: name, value: coerceValue(value, typeOf(name), configOf(name)) });
          }}
          onCommit={(value, move) => {
            listMove.current = move;
            // Compared with (and undone to) the value from before the ticks were previewed
            const previewed = listPreviewRef.current;
            setListPreview(null);
            if (previewed) {
              const value_ = coerceValue(value, typeOf(previewed.key), configOf(previewed.key));
              const original = metaValue(files.find((f) => f.file_id === previewed.file_id), previewed.key);
              const patched = patches.get(previewed.file_id);
              const before = patched && previewed.key in patched ? patched[previewed.key] : original;
              if (sameValue(value_, before)) return;
              const edit = { file_id: previewed.file_id, key: previewed.key, value: value_ };
              history.push({
                label: "Edit",
                undo: () => applyEdits([{ ...edit, value: before ?? null }], { select: true, queued: false }),
                redo: () => applyEdits([edit], { select: true, queued: false }),
              });
              applyEdits([edit]);
              return;
            }
            writeCells([{ ...editingList.ref, value }]);
          }}
          onClose={() => {
            const move = listMove.current;
            listMove.current = "none";
            setListPreview(null);
            endEdit(move);
          }}
        />
      )}

      {valuesEditor && (
        <ValueListEditor
          anchor={valuesEditor.anchor}
          property={propName(valuesEditor.columnId)}
          options={valuesFor(valuesEditor.columnId)}
          sourcesOf={(value) => sourcesOf(valuesEditor.columnId, value)}
          usage={(value) => valueUsage(valuesEditor.columnId, value)}
          onAdd={(value) => addListValue(valuesEditor.columnId, value)}
          onRename={(from, to) => renameListValue(valuesEditor.columnId, from, to)}
          onDelete={(value) => deleteListValue(valuesEditor.columnId, value)}
          onClose={() => setValuesEditor(null)}
        />
      )}

      {propertyMenu && (
        <MenuPopover
          anchor={propertyMenu.anchor}
          entries={propertyMenu.columnId === undefined ? columnMenuEntries() : headerMenuEntries(propertyMenu.columnId)}
          onClose={closeColumnsMenu}
        />
      )}

      {panel && panelButton(panel).current && (
        <FilterSortPopover
          key={panel}
          section={panel}
          anchor={panelButton(panel).current!}
          onClose={closePanel}
          columns={filterColumns}
          rules={rules}
          match={match}
          sorts={sorts}
          onRulesChange={setRules}
          onMatchChange={setMatch}
          onSortsChange={setSorts}
          groups={groupLevels}
          onGroupsChange={setGroupLevels}
          defaultGroupDirection={defaultGroupDirection}
          onCollapseAll={(collapse) => setCollapsed(collapse && groups ? new Set(groupIdsAll(groups)) : new Set())}
          groupLevelState={(depth) => (groups ? levelState(collapsed, groups, depth) : "expanded")}
          onCollapseLevel={(depth, collapse) => groups && setCollapsed(setLevelCollapsed(collapsed, groups, depth, collapse))}
          valuesFor={valuesFor}
        />
      )}


      {deleting && (
        <Dialog
          title={`Delete “${deleting}”?`}
          message="The property and its values are removed from every file in this library. This can't be undone."
          onCancel={() => setDeleting(null)}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setDeleting(null)}>Cancel</DialogButton>
              <DialogButton variant="destructive" onClick={confirmDelete}>
                Delete
              </DialogButton>
            </>
          }
        />
      )}

      {overwriteDialog}

      {tagDrag && <TagDragOverlay drag={tagDrag} box={tagDrag.target && tagDrag.armed ? dropBox(tagDrag.target) : null} hint={tagDrag.armed ? dropHint(tagDrag) : ""} />}

    </div>
  );
}

const MAX_TAGS_SHOWN = 4;

/** Width of a row of pills, for double-click-to-fit. */
/** Pill line height plus the gap between wrapped lines. */
const PILL_LINE = 18;

/** A row tall enough for `lines` lines of pills (one line keeps the standard 20pt). */
function rowHeightFor(lines: number): number {
  return Math.max(ROW_HEIGHT, lines * PILL_LINE + 2);
}

const pillWidths = new Map<string, number>();
/** How many lines `items` take as wrapping pills in `width`. */
function pillLines(items: string[], width: number): number {
  if (items.length === 0 || width <= 0) return 1;
  const font = uiFont(11);
  let lines = 1;
  let x = 0;
  for (const item of items) {
    let w = pillWidths.get(item);
    if (w == null) {
      w = measureText(item, font) + 12; // px-1.5 either side
      pillWidths.set(item, w);
    }
    if (x > 0 && x + 4 + w > width) {
      lines++;
      x = w;
    } else {
      x += (x > 0 ? 4 : 0) + w;
    }
  }
  return lines;
}

/** The row at a vertical offset, given each row's top. */
function rowAtOffset(tops: number[], y: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function measurePills(items: string[]): number {
  const shown = items.slice(0, MAX_TAGS_SHOWN);
  const pills = [...shown];
  if (items.length > MAX_TAGS_SHOWN) pills.push(`+${items.length - MAX_TAGS_SHOWN}`);
  const pillFont = uiFont(11);
  // each pill: text + px-1.5 padding; gap-1 between pills
  return pills.reduce((sum, p, i) => sum + measureText(p, pillFont) + 12 + (i > 0 ? 4 : 0), 0);
}

/**
 * Source tags as pills. A tag already recorded in one of the file's properties
 * is covered and shows faded; dragging a pill onto a column maps it there.
 */
function TagPills({
  tags,
  covered,
  onPillMouseDown,
  wrap,
}: {
  tags: string[];
  covered: Set<string>;
  onPillMouseDown: (e: React.MouseEvent, tag: string) => void;
  /** Shows every tag, wrapping onto more lines (the row grows to fit). */
  wrap: boolean;
}) {
  if (tags.length === 0) return null;
  const shown = wrap ? tags : tags.slice(0, MAX_TAGS_SHOWN);
  const overflow = tags.length - shown.length;
  return (
    <div className={`flex items-center gap-x-1 ${wrap ? "flex-wrap gap-y-0.5" : "flex-nowrap overflow-hidden"}`}>
      {shown.map((tag, i) => (
        <span
          // A path can repeat a folder name ("2024/Q1/2024")
          key={`${i}:${tag}`}
          onMouseDown={(e) => onPillMouseDown(e, tag)}
          title={covered.has(tag) ? `“${tag}” is recorded in a property` : undefined}
          className={`inline-flex items-center h-4 px-1.5 rounded text-[11px] leading-none whitespace-nowrap shrink-0 bg-neutral-500/15 text-neutral-300 data-[pressed]:bg-blue-500 data-[pressed]:text-white data-[pressed]:opacity-100 ${
            covered.has(tag) ? "opacity-40" : ""
          }`}
        >
          {tag}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center h-4 px-1.5 rounded text-[11px] leading-none whitespace-nowrap shrink-0 bg-neutral-500/15 text-neutral-500">
          +{overflow}
        </span>
      )}
    </div>
  );
}

/** Where a dragged pill came from: Source Tags (a folder name), or a list property's values. */
type TagSource = "source" | { property: string };

/** A tag pill being dragged: where it is, and the column it will drop on once armed. */
interface TagDrag {
  value: string;
  source: TagSource;
  x: number;
  y: number;
  target: string | null;
  armed: boolean;
}

/** The dragged pill under the pointer, plus the armed column's highlight and what dropping will do. */
function TagDragOverlay({
  drag,
  box,
  hint,
}: {
  drag: TagDrag;
  box: { left: number; top: number; width: number; height: number } | null;
  hint: string;
}) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]">
      {box && (
        <div
          className="absolute rounded-md border-2 border-blue-500 bg-blue-500/10"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      )}
      {/* The dragged pill sits centred on the pointer, the hint just below it */}
      <span
        className="absolute -translate-x-1/2 -translate-y-1/2 inline-flex items-center h-4 px-1.5 rounded text-[11px] leading-none whitespace-nowrap bg-blue-500 text-white shadow-md"
        style={{ left: drag.x, top: drag.y }}
      >
        {drag.value}
      </span>
      {hint && (
        <span
          className="absolute px-2 py-1 rounded-md text-xs whitespace-nowrap bg-neutral-800 text-neutral-100 border border-neutral-700/60 shadow-lg"
          style={{ left: drag.x + 10, top: drag.y + 14 }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

/** Accent outline drawn on the outer edges of a cell selection (dashed while filling). */
function SelectionFrame({
  edges,
  dashed,
}: {
  edges: { top: boolean; bottom: boolean; left: boolean; right: boolean };
  dashed: boolean;
}) {
  const w = (on: boolean) => (on ? 2 : 0);
  const r = (a: boolean, b: boolean) => (a && b ? 4 : 0);
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 border-blue-500 ${dashed ? "border-dashed" : "border-solid"}`}
      style={{
        borderTopWidth: w(edges.top),
        borderBottomWidth: w(edges.bottom),
        borderLeftWidth: w(edges.left),
        borderRightWidth: w(edges.right),
        borderTopLeftRadius: r(edges.top, edges.left),
        borderTopRightRadius: r(edges.top, edges.right),
        borderBottomLeftRadius: r(edges.bottom, edges.left),
        borderBottomRightRadius: r(edges.bottom, edges.right),
      }}
    />
  );
}
