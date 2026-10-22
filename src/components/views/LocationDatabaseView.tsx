import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useScrollAheadVirtualizer } from "../../hooks/useScrollAheadVirtualizer";
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
  applyRuleWrites,
  deleteRule,
  forgetRuleWrites,
  getPropertyScopes,
  getPropertyValues,
  getRuleWrites,
  getRules,
  reorderRules,
  saveRule,
  renameProperty,
  movePropertyValue,
  renamePropertyValue,
  setEditMenuLabels,
  setFolderLabels,
  setMetadataCells,
  setPropertyScope,
  type CellEdit,
  updatePropertyType,
} from "../../lib/commands";
import type { FileRecord, Property, PropertyConfig, PropertyScope, PropertyValue, ValueType } from "../../types";
import {
  applies,
  dependsOn,
  describeScope,
  impliedValues,
  opensInto,
  propertiesToClear,
  scopeCoverage,
  scopeOrigin,
  scopeState,
  scopesByName,
  type ScopeCondition,
} from "../../lib/scopes";
import ScopeDialog from "./db/ScopeDialog";
import RulesPanel, { RULES_PANEL_MIN_WIDTH } from "./db/RulesPanel";
import { definitionFromFilter, writeKeys, type RuleDefinition, type RuleEnv, type RulePlan, type RuleWrite, type StoredRule } from "../../lib/rules";
import { KIND_BY_TYPE, NATIVE_KINDS, PROP_PREFIX, fileExtension, fileName, metaValue, nativeValue, propName } from "../../lib/fileColumns";
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
import { measureElements, measureText, uiFont } from "../../lib/textMeasure";
import { useColumnLayout } from "../../hooks/useColumnLayout";
import TableHeader from "./shared/TableHeader";
import { useSelection } from "../../hooks/useSelection";
import { useUndo } from "../../hooks/useUndo";
import { setUndoTarget } from "../../lib/editMenu";
import { selectionLabel } from "../../lib/selectionStatus";
import { describeRefresh, type RefreshSummary } from "../../lib/refreshSummary";
import MenuPopover, { type MenuAnchor } from "../shared/MenuPopover";
import Dialog, { DialogButton, DialogField, dialogTextField } from "../shared/Dialog";
import { useTableViews } from "./db/useTableViews";
import { DEFAULT_SORT, legacyTable, uniqueViewName, type ViewDefinition } from "../../lib/tableViews";
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
  DATE_DISPLAY_FORMATS,
  formatDate,
  formatDatePattern,
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
import { HeaderNameEditor, ListCellEditor, ValueListEditor, PropertyValueView, TextCellEditor, PILL_CLASS, PILL_MARK_CLASS, type CommitMove } from "./db/CellEditors";

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

const isEmptyValue = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const CELL = "shrink-0 px-3 truncate whitespace-nowrap";
// Finder list metrics: 20pt rows, rounded stripes inset 10px.
const ROW_HEIGHT = 20;
const NO_IMPLIED: Record<string, string[]> = {};
/** A dragged tag's target over a header: promote it to a property ("header:<column id>"). */
const HEADER_TARGET = "header:";
/** A dragged tag's target between two headers: a new property there ("insert:<index among the columns>"). */
const INSERT_TARGET = "insert:";
/** How near a header's edge counts as between two columns. */
const INSERT_EDGE = 10;
/** Whether `list` holds `value`, ignoring case (as scope conditions match). */
const hasText = (list: string[], value: string) =>
  list.some((v) => v.localeCompare(value, undefined, { sensitivity: "base" }) === 0);
/** "Housing", "Housing and Cover", "Housing, Cover and Type". */
function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
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
  /** The rule being looked at in the Rules panel: the table shows only its files. */
  const [ruleFocus, setRuleFocus] = useState<{ name: string; definition: RuleDefinition } | null>(null);
  /** Grouping levels (outermost first) and the groups folded shut; both kept per location. */
  const [groupLevels, setGroupLevels] = useState<GroupLevel[]>([]);
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
  const { structureLocationId } = useNavigation();
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
  /** Conditions on scoped properties ("Housing applies when Tags has housing"), as the registry stores them. */
  const [scopeRows, setScopeRows] = useState<PropertyScope[]>([]);
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
    setIndexing(null);
    setError(null);
    setPropertyMenu(null);
    setPanel(null);
    setRenaming(null);
    setPatches(new Map());

    // Filters, sorts, groups and columns come from the location's view (useTableViews)
    setCollapsedState(new Set(loadJson<string[]>(`col-group-collapsed-${locationId}`, [])));
  }, [locationId]);

  // ── Views ─────────────────────────────────────────────────────────────────

  /** Bumped with each view put into the table, so that render isn't recorded as an edit. */
  const [appliedView, setAppliedView] = useState(0);
  /** Puts a view's filters, sorts, groups and columns into the table. */
  const applyView = useCallback((def: ViewDefinition) => {
    const t = def.table;
    setRules(t.filters);
    setMatch(t.match);
    setSorts(t.sorts);
    setGroupLevels(t.groups);
    setHiddenStandard(t.hiddenStandard);
    setColumnOrder(t.columnOrder);
    setShowTags(t.showTags);
    setHideCovered(t.hideCovered);
    setWrapSourceTags(t.wrapSourceTags);
    setVisibleProperties(t.visibleProperties);
    setNoWrap(t.noWrap);
    setFrozen(t.frozen);
    setAppliedView((n) => n + 1);
  }, []);
  const tableViews = useTableViews(
    locationId,
    applyView,
    // The default view starts from the column settings kept before views existed
    () => ({ table: legacyTable((key) => loadJson<unknown>(`${key}-${locationId}`, undefined)) }),
    setError
  );
  const currentView: ViewDefinition = useMemo(
    () => ({
      table: {
        filters: rules,
        match,
        sorts,
        groups: groupLevels,
        hiddenStandard,
        columnOrder,
        showTags,
        hideCovered,
        wrapSourceTags,
        visibleProperties,
        noWrap,
        frozen,
      },
    }),
    [rules, match, sorts, groupLevels, hiddenStandard, columnOrder, showTags, hideCovered, wrapSourceTags, visibleProperties, noWrap, frozen]
  );
  const recordedApply = useRef(-1);
  const recordView = tableViews.record;
  useEffect(() => {
    // The render a view was applied in (or the first) shows the view itself, not an edit
    if (recordedApply.current !== appliedView) {
      recordedApply.current = appliedView;
      return;
    }
    recordView(currentView);
  }, [currentView, appliedView, recordView]);

  /** Save as New View… or Rename View…, while its sheet is open. */
  const [viewNaming, setViewNaming] = useState<{ mode: "new" | "rename"; text: string; error?: string } | null>(null);
  const [deletingView, setDeletingView] = useState(false);

  function showViewMenu(e: React.MouseEvent) {
    const { views, active, edited } = tableViews;
    const named = !!active && !active.is_default;
    showContextMenu(
      [
        ...views.map(
          (v): MenuEntry => ({
            type: "check",
            text: v.name,
            checked: v.view_id === active?.view_id,
            action: () => void tableViews.select(v.view_id),
            key: v.view_id,
          })
        ),
        { type: "separator" },
        { type: "item", text: "Save Changes", enabled: edited, action: () => void tableViews.saveChanges() },
        { type: "item", text: "Revert Changes", enabled: edited, action: () => void tableViews.revert() },
        {
          type: "item",
          text: "Save as New View…",
          action: () =>
            setViewNaming({ mode: "new", text: uniqueViewName(named ? active.name : "New View", views.map((v) => v.name)) }),
        },
        { type: "separator" },
        {
          type: "item",
          text: "Rename View…",
          enabled: named,
          action: () => active && setViewNaming({ mode: "rename", text: active.name }),
        },
        { type: "item", text: "Delete View…", enabled: named, action: () => setDeletingView(true) },
      ],
      // A pop-up button: the menu opens with the current view under the pointer
      { event: e, alignKey: active?.view_id }
    );
  }

  async function submitViewName() {
    if (!viewNaming || !tableViews.active) return;
    const name = viewNaming.text.trim();
    if (!name) return;
    try {
      if (viewNaming.mode === "new") await tableViews.saveAs(name);
      else await tableViews.rename(tableViews.active.view_id, name);
      setViewNaming(null);
    } catch (e) {
      setViewNaming({ ...viewNaming, error: String(e) });
    }
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

  // Re-read keys whenever Map Structure closes: mappings can add properties
  useEffect(() => {
    if (!structureOpen) loadKeys();
  }, [structureOpen, loadKeys]);

  const loadRegistry = useCallback(async () => {
    if (!library) {
      setRegistry([]);
      setScopeRows([]);
      return;
    }
    const [props, scopeList] = await Promise.all([getProperties(library), getPropertyScopes(library)]);
    setRegistry(props);
    setScopeRows(scopeList);
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

  /**
   * Refetches every list property's values, keeping the current ones until the
   * new arrive: clearing them first would drop the renamed-value aliases for a
   * render, and covered Source Tags would flash back.
   */
  const registryRef = useRef(registry);
  registryRef.current = registry;
  const registryReload = useRef(0);
  const reloadRegistryValues = useCallback(() => {
    const seq = ++registryReload.current;
    const lists = registryRef.current.filter((p) => p.value_type === "enum" || p.value_type === "array");
    Promise.all(lists.map((p) => getPropertyValues(p.property_id).then((vs) => [p.property_id, vs] as const)))
      .then((entries) => {
        if (seq === registryReload.current) setRegistryValues(Object.fromEntries(entries));
      })
      .catch(() => {});
  }, []);

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

  /** Scoped properties by name: where each applies (see lib/scopes). */
  const scopes = useMemo(() => {
    const nameById = new Map(registry.map((p) => [p.property_id, p.name]));
    return scopesByName(scopeRows, (id) => nameById.get(id));
  }, [registry, scopeRows]);
  const scopeOf = useCallback((name: string) => scopes.find((s) => s.property === name), [scopes]);
  const isListProperty = useCallback((name: string) => typeOf(name) === "array", [typeOf]);

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

  /**
   * Values files hold only by implication (Housing = Rent implies Tags has
   * `housing`): shown faded, and counted by filters, sorting and grouping, but
   * never written back as stored values.
   */
  const impliedByFile = useMemo(() => {
    const map = new Map<string, Record<string, string[]>>();
    if (scopes.length === 0) return map;
    for (const f of rows) {
      const implied = impliedValues(f.metadata as Record<string, unknown> | null, scopes, isListProperty);
      if (Object.keys(implied).length > 0) map.set(f.file_id, implied);
    }
    return map;
  }, [rows, scopes, isListProperty]);
  const impliedFor = useCallback((fileId: string) => impliedByFile.get(fileId) ?? NO_IMPLIED, [impliedByFile]);

  /** A property's value with any implied values added. */
  const effectiveValue = useCallback(
    (file: FileRecord | undefined, name: string): unknown => {
      const value = metaValue(file, name);
      const implied = file ? impliedByFile.get(file.file_id)?.[name] : undefined;
      if (!implied) return value;
      const stored = listValues(value);
      return typeOf(name) === "array" || stored.length + implied.length > 1 ? [...stored, ...implied] : implied[0];
    },
    [impliedByFile, typeOf]
  );

  const columnValue = useCallback(
    (file: FileRecord, columnId: string): unknown =>
      columnId.startsWith(PROP_PREFIX) ? effectiveValue(file, propName(columnId)) : nativeValue(file, columnId),
    [effectiveValue]
  );

  const sortValue = useCallback(
    (file: FileRecord, columnId: string): string | number | null | undefined => {
      if (!columnId.startsWith(PROP_PREFIX)) {
        const v = nativeValue(file, columnId);
        return Array.isArray(v) ? v.join(", ") : (v as string | number | null);
      }
      const name = propName(columnId);
      const v = effectiveValue(file, name);
      if (v == null) return null;
      const type = typeOf(name);
      if (type === "number" && typeof v === "number") return v;
      if (type === "date") return dateKey(v) ?? valueToText(v);
      return valueToText(v);
    },
    [typeOf, effectiveValue]
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
    const filtered = applyFilters(searched, rules, match, columnValue, kindOf);
    // While a rule is looked at in the Rules panel, just the files it applies to
    const focused = ruleFocus
      ? applyFilters(filtered, ruleFocus.definition.conditions, ruleFocus.definition.match, columnValue, kindOf)
      : filtered;
    return multiSort(focused, sorts, sortValue);
  }, [rows, search, rules, match, sorts, columnValue, kindOf, sortValue, ruleFocus]);

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
      const v = effectiveValue(file, name);
      if (isEmptyValue(v)) {
        // A scoped property's files it doesn't apply to group apart from those still missing a value
        const scope = scopeOf(name);
        if (scope && !applies(scope, file.metadata as Record<string, unknown> | null, impliedFor(file.file_id))) {
          return { label: "Doesn't Apply", rank: "\uffff" };
        }
        return null;
      }
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
    [typeOf, effectiveValue, scopeOf, impliedFor]
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
  }

  function toggleShowTags() {
    const next = !showTags;
    setShowTags(next);
  }

  function toggleHideCovered() {
    const next = !hideCovered;
    setHideCovered(next);
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
    setVisibleProperties(update);
  }

  function toggleProperty(name: string) {
    updateVisibleProperties((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
  }

  function toggleWrap(name: string) {
    setNoWrap((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
  }

  function toggleWrapSourceTags() {
    setWrapSourceTags((w) => !w);
  }

  /** Multi-select values wrap onto more lines, growing the row, unless turned off. */
  const wraps = useCallback((name: string) => typeOf(name) === "array" && !noWrap.includes(name), [typeOf, noWrap]);

  function toggleFrozen() {
    setFrozen((f) => !f);
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
    setShowTags(shown);
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

  // ── Rules ─────────────────────────────────────────────────────────────────

  const [rulesOpen, setRulesOpen] = useState(false);
  /** The Rules panel's width, dragged at its left edge; kept between sessions. */
  const [rulesWidth, setRulesWidthState] = useState(() => Math.max(RULES_PANEL_MIN_WIDTH, loadJson("rules-panel-width", 760)));
  function setRulesWidth(width: number, save: boolean) {
    setRulesWidthState(width);
    if (save) saveJson("rules-panel-width", width);
  }
  const [ruleList, setRuleList] = useState<StoredRule[]>([]);
  const [ruleWrites, setRuleWrites] = useState<RuleWrite[]>([]);
  /** A new rule to start from (Make Rule from Filter…), and a key so the panel starts afresh with it. */
  const [ruleDraft, setRuleDraft] = useState<RuleDefinition | null>(null);
  const [ruleDraftKey, setRuleDraftKey] = useState(0);
  const setRuleFocusStable = useCallback((f: { name: string; definition: RuleDefinition } | null) => setRuleFocus(f), []);

  const loadRules = useCallback(async () => {
    if (!library) return;
    const [list, writes] = await Promise.all([getRules(library), getRuleWrites(library)]);
    setRuleList(list);
    setRuleWrites(writes);
  }, [library]);
  useEffect(() => {
    loadRules().catch(() => {});
  }, [loadRules, files]);

  /** The view's filter (and search) as a rule's conditions, when it has any. */
  const viewFilterRule = useMemo(() => {
    const def = definitionFromFilter(rules, match, search);
    return def.conditions.length > 0 ? def : null;
  }, [rules, match, search]);

  function openRules(draft: RuleDefinition | null) {
    setRuleDraft(draft);
    setRuleDraftKey((k) => k + 1);
    setRulesOpen(true);
  }

  /** How rules read this table: its own columns (implied values included), kinds and properties. */
  const ruleEnvHere: RuleEnv = useMemo(
    () => ({
      valueOf: columnValue,
      kindOf,
      typeOf: (name) => propByName.get(name)?.value_type ?? (metadataKeys.includes(name) ? "free_text" : null),
      configOf,
      written: writeKeys(ruleWrites),
    }),
    [columnValue, kindOf, propByName, metadataKeys, configOf, ruleWrites]
  );

  async function saveRuleHere(rule: StoredRule): Promise<StoredRule | null> {
    try {
      const saved = await saveRule(rule);
      await loadRules();
      return saved;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }

  /** Rules ▸ Then set ▸ New Property…: a new property of that type, shown in the table; undoable. */
  async function createPropertyForRule(name: string, type: ValueType): Promise<boolean> {
    if (availableProperties.some((p) => p.toLowerCase() === name.toLowerCase())) {
      setError(`“${name}” already exists`);
      return false;
    }
    try {
      await history.queue(() => coreCreate(name, type, null));
    } catch (e) {
      setError(String(e));
      return false;
    }
    history.push({ label: "Add Property", undo: () => coreDelete(name), redo: () => coreCreate(name, type, null) });
    return true;
  }

  /** Apply Now: the rule's planned values written and recorded as its own; one undo puts them back. */
  async function applyRuleNow(rule: StoredRule, plan: RulePlan) {
    if (plan.edits.length === 0) return;
    const previous = plan.edits.map((e) => ({ ...e, value: storedMeta(e.file_id)[e.key] ?? null }));
    const apply = async () => {
      await applyRuleWrites(plan.edits, plan.writes);
      await loadRules();
      reloadRegistryValues();
      onChanged?.();
    };
    try {
      await history.queue(apply);
    } catch (e) {
      setError(String(e));
      return;
    }
    history.push({
      label: `Apply “${rule.name}”`,
      undo: async () => {
        await setMetadataCells(previous);
        await forgetRuleWrites(plan.writes);
        await loadRules();
        onChanged?.();
      },
      redo: apply,
    });
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
    reloadRegistryValues();
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
    setColumnOrder((prev) => prev.map((id) => (id === oldId ? newId : id)));
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
    // Edits waiting to save go first, so the rename (which updates saved views) covers them
    await tableViews.flush();
    await renameProperty(prop.property_id, to);
    await tableViews.reload();
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

  // Right-click on a header: actions for that column, with the column list in a
  // submenu. Empty header space shows the column list itself, as in Finder.
  function handleHeaderMenu(e: React.MouseEvent, columnId: string | null) {
    e.preventDefault();
    setPropertyMenu({ anchor: { x: e.clientX, y: e.clientY }, columnId });
  }

  function headerMenuEntries(columnId: string | null): MenuEntry[] {
    const col = columns.find((c) => c.id === columnId && c.id !== ADD_COLUMN.id);
    if (!col) return columnMenuEntries();
    const entries: MenuEntry[] = [];
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
    // Deleting sits with Hide, apart from the settings that change the property
    let deleteEntry: MenuEntry | null = null;
    if (isEditable(col.id)) {
      const name = propName(col.id);
      entries.push(
        { type: "separator" },
        { type: "item", text: "Rename Property…", action: () => setRenaming({ name, text: name }) }
      );
      if (typeOf(name) === "enum" || typeOf(name) === "array") {
        entries.push({ type: "item", text: "Edit Values…", action: () => openValuesEditor(col.id) });
      }
      if (typeOf(name) === "date") {
        // Each format shown with today's date in it
        const current = configOf(name).dateFormat ?? "medium";
        const today = new Date().toISOString().slice(0, 10);
        entries.push({
          type: "submenu",
          text: "Date Format",
          items: [
            ...DATE_DISPLAY_FORMATS.map(
              (f): MenuEntry => ({
                type: "check",
                text: `${f.label}  ${formatDate(today, f.id)}`,
                checked: current === f.id,
                action: () => void changeType(name, "date", f.id === "medium" ? null : { dateFormat: f.id }),
              })
            ),
            { type: "separator" },
            {
              type: "check",
              text: current.startsWith("custom:") ? `Custom…  ${formatDate(today, current)}` : "Custom…",
              checked: current.startsWith("custom:"),
              action: () =>
                setDateFormatEditing({ name, pattern: current.startsWith("custom:") ? current.slice(7) : "DD/MM/YYYY" }),
            },
          ],
        });
      }
      if (typeOf(name) === "array") {
        entries.push({ type: "check", text: "Wrap Values", checked: wraps(name), action: () => toggleWrap(name) });
      }
      // The built-in Tags property is always a Multi-select, can't be deleted, and
      // stays flat labels: it's what other properties are scoped to
      if (name !== tagsProperty) {
        entries.push(
          { type: "submenu", text: "Property Type", items: typeMenu(name) },
          { type: "item", text: "Apply Only Where…", action: () => setScopeEditing(name) }
        );
        const scope = scopeOf(name);
        if (scope) {
          entries.push({
            type: "item",
            text: `Apply to All Files (not just ${scope.conditions.map((c) => c.value).join(", ")})`,
            action: () => void changeScope(name, [], "Apply to All Files"),
          });
        }
        deleteEntry = { type: "item", text: "Delete Property…", action: () => setDeleting(name) };
      }
    }
    entries.push(
      { type: "separator" },
      // Name can't be hidden; freezing only applies to it
      col.id === "name"
        ? { type: "check", text: "Freeze Name", checked: frozen, action: toggleFrozen }
        : { type: "item", text: `Hide “${col.label}”`, action: () => hideColumn(col.id) },
      ...(deleteEntry ? [deleteEntry] : []),
      { type: "separator" },
      { type: "submenu", text: "Show Properties", items: columnMenuEntries() }
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
    // Only the tags shown count: hiding recorded ones shrinks the row. Implied values
    // and the "›" on values that open into a property take room too
    const rows = sorted.map((f) => {
      const implied = impliedByFile.get(f.file_id);
      return {
        tags: tagsWidth == null ? [] : shownSourceTags(f),
        lists: wrapping.map(({ name }) => [...listValues(metaValue(f, name)), ...(implied?.[name] ?? [])]),
      };
    });
    // Every pill measured in one layout pass, as the page lays it out
    const widths = measureElements(
      rows.flatMap((r) => [...r.tags, ...r.lists.flat()]),
      PILL_CLASS
    );
    const mark = (measureElements(["›"], `${PILL_MARK_CLASS} text-[11px] leading-none`).get("›") ?? 0) + 2; // gap-0.5 before it
    return rows.map(({ tags, lists }) => {
      let lines = tagsWidth == null ? 1 : pillLines(tags, tagsWidth, widths, (t) => (opensInto(scopes, null, t).length > 0 ? mark : 0));
      wrapping.forEach(({ name, width }, i) => {
        lines = Math.max(lines, pillLines(lists[i], width, widths, (v) => (opensInto(scopes, name, v).length > 0 ? mark : 0)));
      });
      return rowHeightFor(lines);
    });
  }, [columns, isEditable, wraps, wrapSourceTags, shownSourceTags, layout.widths, sorted, impliedByFile, scopes]);
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

  const rowVirtualizer = useScrollAheadVirtualizer({
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
    reloadRegistryValues();
    if (pendingWrites.current === 0) {
      onChanged?.();
      loadKeys();
    }
  }

  /** The scoped properties whose values imply `value` in `name` on a file ("from House"). */
  function impliedSourcesOf(fileId: string, name: string, value: string): string[] {
    const file = rows.find((f) => f.file_id === fileId);
    if (!file) return [];
    return scopes
      .filter(
        (sc) =>
          sc.conditions.length === 1 &&
          sc.conditions[0].property === name &&
          hasText([sc.conditions[0].value], value) &&
          listValues(effectiveValue(file, sc.property)).length > 0
      )
      .map((sc) => sc.property);
  }

  /** A file's stored metadata: from disk plus edits in flight, without an open picker's preview. */
  function storedMeta(fileId: string): Record<string, unknown> {
    const file = files.find((f) => f.file_id === fileId);
    return { ...((file?.metadata as Record<string, unknown> | null) ?? {}), ...(patches.get(fileId) ?? {}) };
  }

  /**
   * A Select / Multi-select cell's new values from its picker. Values that are
   * only implied stay unstored; removing a value (stored or implied) that a
   * scoped property's value depends on asks first, then clears that property
   * (and any scoped beneath it) in the same undoable edit.
   */
  async function commitListCell(ref: CellRef, picked: unknown, dropped: string[] = []) {
    const name = propName(ref.col);
    const type = typeOf(name);
    const meta = storedMeta(ref.row);
    const before = meta[name] ?? null;
    // `picked` is what's set directly; implied values not dropped stay implied as they were
    const next = listValues(coerceValue(picked, type, configOf(name)));
    const storedBefore = listValues(before);
    const sourced = (v: string) => impliedSourcesOf(ref.row, name, v).length > 0;
    // Gone for good: dropped implied values, and stored values unticked that nothing implies.
    // A stored value unticked back to implied just stops being stored.
    const removed = [
      ...dropped,
      ...storedBefore.filter((v) => !hasText(next, v) && !sourced(v) && !hasText(dropped, v)),
    ];
    const cleared = removed.length > 0 ? propertiesToClear(meta, scopes, name, removed) : [];
    if (cleared.length > 0) {
      // Only the removed values something depended on are named
      const named = removed.filter((v) =>
        scopes.some((sc) => cleared.includes(sc.property) && sc.conditions.some((c) => c.property === name && hasText([c.value], v)))
      );
      if (!(await confirmRemoval(named.length > 0 ? named : removed, cleared))) return;
    }
    const value = type === "array" ? (next.length > 0 ? next : null) : (next[0] ?? null);
    const edits: CellEdit[] = [];
    if (!sameValue(value, before)) edits.push({ file_id: ref.row, key: name, value });
    for (const p of cleared) edits.push({ file_id: ref.row, key: p, value: null });
    if (edits.length === 0) return;
    const previous = edits.map((e) => ({ ...e, value: meta[e.key] ?? null }));
    history.push({
      label: cleared.length > 0 ? `Remove “${removed[0]}”` : "Edit",
      undo: () => applyEdits(previous, { select: true, queued: false }),
      redo: () => applyEdits(edits, { select: true, queued: false }),
    });
    await applyEdits(edits);
  }

  /** "Remove “housing”? Housing depends on it…": resolves true to go ahead. */
  const [removalPrompt, setRemovalPrompt] = useState<{
    values: string[];
    cleared: string[];
    resolve: (ok: boolean) => void;
  } | null>(null);
  function confirmRemoval(values: string[], cleared: string[]): Promise<boolean> {
    return new Promise((resolve) => setRemovalPrompt({ values, cleared, resolve }));
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

  /**
   * Press on a cell and drag: selects the block of cells from it to the one
   * under the pointer, as in a spreadsheet, scrolling at the table's edges.
   * Shift extends from the selection's anchor; ⌘ (Ctrl) adds the block to it.
   * A press without a drag is left to the click.
   */
  function startCellDrag(e: React.MouseEvent, ref: CellRef) {
    // Not from a pill (that drags the value) or with a button other than the first
    if (e.button !== 0 || e.defaultPrevented || editing) return;
    const container = layout.container;
    const body = rowsRef.current;
    if (!container || !body) return;
    const dragGrid = grid;
    const base = cellSel;
    const toggle = isToggleSelect(e);
    const anchor = e.shiftKey && base.anchor ? base.anchor : ref;
    const start = { x: e.clientX, y: e.clientY };
    let last = start;
    let dragging = false;
    let frame = 0;
    let current = ref;

    const rowAt = (clientY: number): string => {
      const y = clientY - body.getBoundingClientRect().top;
      // Over a group heading, the row just after it (or the last row, past the end)
      let item = rowAtOffset(itemTops, Math.max(0, y));
      while (item < items.length && items[item].type === "group") item++;
      const at = items[item];
      const index = at?.type === "row" ? at.index : dragGrid.rows.length - 1;
      return dragGrid.rows[Math.max(0, Math.min(dragGrid.rows.length - 1, index))];
    };
    // The editable column under the pointer, or the nearest one beside it
    const colAt = (clientX: number, clientY: number): string => {
      const under = columnAtPoint(clientX, Math.min(Math.max(clientY, container.getBoundingClientRect().top + 30), container.getBoundingClientRect().bottom - 1));
      if (under && dragGrid.cols.includes(under)) return under;
      const r = container.getBoundingClientRect();
      const offset = clientX - r.left - INSET + container.scrollLeft;
      const boxes = columnBoxes();
      let best = dragGrid.cols[0];
      let bestDistance = Infinity;
      let left = 0;
      for (const b of boxes) {
        if (dragGrid.cols.includes(b.id)) {
          const distance = offset < left ? left - offset : offset > left + b.width ? offset - left - b.width : 0;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = b.id;
          }
        }
        left += b.width;
      }
      return best;
    };
    const update = () => {
      const next = { row: rowAt(last.y), col: colAt(last.x, last.y) };
      if (next.row === current.row && next.col === current.col && dragging) return;
      current = next;
      const block = rectCells(anchor, next, dragGrid).map(cellKey);
      setCellSel({ cells: toggle ? new Set([...base.cells, ...block]) : new Set(block), anchor, active: next });
    };
    // Holding near an edge scrolls, faster the further out
    const tick = () => {
      const r = container.getBoundingClientRect();
      const top = r.top + 28;
      const edge = 24;
      const dy = last.y < top + edge ? -(top + edge - last.y) / 3 : last.y > r.bottom - edge ? (last.y - r.bottom + edge) / 3 : 0;
      const dx = last.x < r.left + edge ? -(r.left + edge - last.x) / 3 : last.x > r.right - edge ? (last.x - r.right + edge) / 3 : 0;
      if (dy || dx) {
        container.scrollTop += dy;
        container.scrollLeft += dx;
        update();
      }
      frame = requestAnimationFrame(tick);
    };
    const onMove = (ev: MouseEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!dragging) {
        if (Math.hypot(last.x - start.x, last.y - start.y) < DRAG_THRESHOLD) return;
        dragging = true;
        selection.clear();
        frame = requestAnimationFrame(tick);
      }
      ev.preventDefault();
      update();
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      cancelAnimationFrame(frame);
      if (!dragging) return;
      // The click that ends the drag would make the selection one cell again
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      focusSink();
    };
    // No text selection while dragging across cells
    e.preventDefault();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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

  /**
   * What a drop at a point would do: on a header, promote the tag to a property
   * of its own ("header:<column>"); on a list column, become one of its values;
   * on "+" or right of the columns, become a value of a new Multi-select.
   */
  function dropTargetAt(x: number, y: number, source: TagSource): string | null {
    const container = layout.container;
    if (!container) return null;
    const r = container.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    if (x - r.left - INSET + container.scrollLeft < 0) return null;
    const col = columnAtPoint(x, y);
    const headerBottom = container.querySelector("[data-table-header]")?.getBoundingClientRect().bottom ?? r.top + 28;
    if (y <= headerBottom) return headerTarget(x - r.left - INSET + container.scrollLeft, col, source);
    if (!col) return ADD_COLUMN.id;
    return canDropTag(col, source) ? col : null;
  }

  /**
   * Over the header row: near the edge between two columns, a new property
   * there; over a property's own header, that property (to link to); over "+"
   * or right of the columns, a new property at the end; over a header that
   * can't take it (Name, Size… or the tag's own column), a new property after it.
   */
  function headerTarget(offset: number, col: string | null, source: TagSource): string {
    const boxes = columnBoxes();
    const last = boxes.length - 1; // "+"
    // Edges between columns, from after Name (nothing goes before it) to before "+"
    let left = 0;
    for (let i = 0; i < last; i++) {
      left += boxes[i].width;
      if (Math.abs(offset - left) <= INSERT_EDGE) return INSERT_TARGET + (i + 1);
    }
    if (!col || col === ADD_COLUMN.id) return INSERT_TARGET + last;
    const own = source !== "source" && col === PROP_PREFIX + source.property;
    if (isEditable(col) && !own && col !== PROP_PREFIX + tagsProperty) return HEADER_TARGET + col;
    return INSERT_TARGET + (boxes.findIndex((b) => b.id === col) + 1);
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
      const next = dropTargetAt(last.x, last.y, source);
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
    if (columnId.startsWith(HEADER_TARGET)) {
      openPromote(value, source, { linkTo: propName(columnId.slice(HEADER_TARGET.length)) });
      return;
    }
    if (columnId.startsWith(INSERT_TARGET)) {
      openPromote(value, source, { at: Number(columnId.slice(INSERT_TARGET.length)) });
      return;
    }
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
      },
      redo: apply,
    });
  }

  /** "Move “Acme” to Client · 14 files, 2 folders", shown once a hovered column will take the drop. */
  function dropHint(d: TagDrag): string {
    if (!d.target) return "";
    if (d.target.startsWith(HEADER_TARGET)) return `Link “${d.value}” to ${propName(d.target.slice(HEADER_TARGET.length))}…`;
    if (d.target.startsWith(INSERT_TARGET)) return `New property from “${d.value}” here…`;
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
  function dropBox(target: string): { left: number; top: number; width: number; height: number; line?: boolean } | null {
    const container = layout.container;
    if (!container) return null;
    const r = container.getBoundingClientRect();
    // Between columns: an insertion line down the table at that edge
    if (target.startsWith(INSERT_TARGET)) {
      const index = Number(target.slice(INSERT_TARGET.length));
      const offset = columnBoxes().slice(0, index).reduce((sum, b) => sum + b.width, 0);
      const x = r.left + INSET + offset - container.scrollLeft;
      if (x < r.left || x > r.right) return null;
      return { left: x - 1, top: r.top, width: 2, height: r.height, line: true };
    }
    // A header target highlights just that header
    const header = target.startsWith(HEADER_TARGET);
    const columnId = header ? target.slice(HEADER_TARGET.length) : target;
    const headerBottom = container.querySelector("[data-table-header]")?.getBoundingClientRect().bottom ?? r.top + 28;
    const left = r.left + INSET + columnOffset(columnId, columnBoxes()) - container.scrollLeft;
    const right = Math.min(r.right, left + (layout.widths[columnId] ?? 0));
    const clipped = Math.max(r.left, left);
    return { left: clipped, top: r.top, width: Math.max(0, right - clipped), height: header ? headerBottom - r.top : r.height };
  }

  // ── Promoting a tag to a property ─────────────────────────────────────────

  /** The Make Property dialog: a tag or value becoming a property scoped to it. */
  const [promoting, setPromoting] = useState<{
    value: string;
    source: TagSource;
    name: string;
    type: "enum" | "array";
    /** Where a new property's column goes (index among the columns); null: just after the tag's own column. */
    at: number | null;
  } | null>(null);

  /**
   * Opens Make a property. Dropped on a property's header, the name is that
   * property's, so Return links to it; otherwise it's the tag, capitalised.
   * Either way the name can be changed: a name that exists links, a new one creates.
   */
  function openPromote(value: string, source: TagSource, where: { linkTo?: string; at?: number } = {}) {
    const name = where.linkTo ?? value.charAt(0).toUpperCase() + value.slice(1);
    setPromoting({ value, source, name, type: "enum", at: where.at ?? null });
  }

  /**
   * Right-click on a pill: Make Property from it, and for a value that opens
   * into a scoped property, Unlink it (that property stops depending on it).
   */
  function showPillMenu(e: React.MouseEvent, value: string, source: TagSource) {
    e.preventDefault();
    e.stopPropagation();
    // A source tag's link runs through Tags (or the property its folders map to)
    const linked = scopes.filter((sc) =>
      sc.conditions.some((c) => (source === "source" || c.property === source.property) && hasText([c.value], value))
    );
    const entries: MenuEntry[] = [{ type: "item", text: `Make Property from “${value}”…`, action: () => openPromote(value, source) }];
    if (linked.length > 0) entries.push({ type: "separator" });
    for (const sc of linked) {
      const rest = sc.conditions.filter(
        (c) => !((source === "source" || c.property === source.property) && hasText([c.value], value))
      );
      entries.push({
        type: "item",
        text: `Unlink “${value}” from ${sc.property}`,
        action: () => void changeScope(sc.property, rest, "Unlink"),
      });
    }
    showContextMenu(entries, { event: e });
  }

  /** Puts a property's column just after another (the one its tag came from). */
  function placeBeside(name: string, besideId: string) {
    const newId = PROP_PREFIX + name;
    const ids = columns.filter((c) => c.id !== ADD_COLUMN.id && c.id !== newId).map((c) => c.id);
    const at = ids.indexOf(besideId);
    const visible = at === -1 ? [...ids, newId] : [...ids.slice(0, at + 1), newId, ...ids.slice(at + 1)];
    const next = [...visible, ...columnOrder.filter((id) => !visible.includes(id))];
    setColumnOrder(next);
  }

  /**
   * Makes `name` a property scoped to the tag: it applies where the tag is held.
   * A hand-added tag or value is the condition as it stands; a source tag's
   * folders are mapped into Tags first (so the condition holds on every
   * refresh), unless they're already mapped to a property, which is then the
   * condition. An existing property of that name is linked rather than duplicated.
   */
  async function promoteTag(value: string, source: TagSource, name: string, type: "enum" | "array", at: number | null) {
    if (!library) return;
    const existing = await findProperty(name);
    const conditionNames: string[] = [];
    let mapFolders: string[] = [];
    if (source === "source") {
      const folders = await foldersNamed(locationId, value);
      const nodes = (await getMappingNodes(locationId)).filter((n) => folders.includes(n.folder_path));
      mapFolders = folders.filter((f) => !nodes.some((n) => n.folder_path === f));
      for (const n of nodes) if (!conditionNames.includes(n.property_name)) conditionNames.push(n.property_name);
      if (mapFolders.length > 0 || conditionNames.length === 0) {
        if (!tagsProperty) throw new Error("This library has no Tags property");
        conditionNames.unshift(tagsProperty);
      }
    } else {
      conditionNames.push(source.property);
    }
    if (existing && conditionNames.includes(name)) throw new Error(`“${name}” can't depend on itself`);
    const beside = source === "source" ? TAGS_COLUMN.id : PROP_PREFIX + source.property;
    const tagsBefore = tagsProperty ? snapshot(tagsProperty) : [];
    const scopeBefore = existing
      ? scopeRows.filter((sc) => sc.property_id === existing.property_id).map((sc) => ({ property_id: sc.condition_property_id, value: sc.value }))
      : [];

    const apply = async () => {
      if (mapFolders.length > 0 && tagsProperty) {
        await setFolderLabels(locationId, mapFolders, tagsProperty, false);
      }
      if (existing) updateVisibleProperties((prev) => (prev.includes(name) ? prev : [...prev, name]));
      else await coreCreate(name, type, null);
      const prop = await findProperty(name);
      if (!prop) throw new Error(`“${name}” wasn't created`);
      const conditions = [...(existing ? scopeBefore : [])];
      for (const c of conditionNames) {
        const cond = await findProperty(c);
        if (cond && !conditions.some((x) => x.property_id === cond.property_id && hasText([x.value], value))) {
          conditions.push({ property_id: cond.property_id, value });
        }
      }
      await setPropertyScope(prop.property_id, conditions);
      if (!existing) placeBeside(name, at != null ? columns[at - 1]?.id ?? beside : beside);
      await afterPropertyChange();
    };
    try {
      await history.queue(apply);
    } catch (e) {
      setError(String(e));
      return;
    }
    history.push({
      label: "Make Property",
      undo: async () => {
        if (existing) {
          await setPropertyScope(existing.property_id, scopeBefore);
        } else {
          await coreDelete(name);
        }
        if (mapFolders.length > 0) {
          await clearFolderLabels(locationId, mapFolders);
          await restoreValues(tagsBefore);
        }
        await afterPropertyChange();
      },
      redo: apply,
    });
  }

  /** Header menu ▸ Date Format ▸ Custom…: the property and pattern being edited. */
  const [dateFormatEditing, setDateFormatEditing] = useState<{ name: string; pattern: string } | null>(null);

  /** Header menu ▸ Apply Only Where…: the property being scoped, while its dialog is open. */
  const [scopeEditing, setScopeEditing] = useState<string | null>(null);

  /**
   * Replaces where a property applies (Apply Only Where…), or with no
   * conditions makes it apply to every file (Apply to All Files, Unlink).
   * Values the old conditions implied are kept: they become stored values, so
   * no file loses a tag it was showing. Undoable as one step.
   */
  async function changeScope(name: string, conditions: ScopeCondition[], label: string) {
    const prop = await findProperty(name);
    if (!prop) return;
    const before = scopeRows
      .filter((sc) => sc.property_id === prop.property_id)
      .map((sc) => ({ property_id: sc.condition_property_id, value: sc.value }));
    const nextScopes = [
      ...scopes.filter((sc) => sc.property !== name),
      ...(conditions.length > 0 ? [{ property: name, conditions }] : []),
    ];
    // Implied now but not after: write them as stored values
    const keep: CellEdit[] = [];
    const previous: CellEdit[] = [];
    for (const f of rows) {
      const meta = f.metadata as Record<string, unknown> | null;
      const was = impliedByFile.get(f.file_id);
      if (!was) continue;
      const will = impliedValues(meta, nextScopes, isListProperty);
      for (const [key, values] of Object.entries(was)) {
        const lost = values.filter((v) => !hasText(will[key] ?? [], v));
        if (lost.length === 0) continue;
        const stored = listValues(meta?.[key]);
        const value = typeOf(key) === "array" ? [...stored, ...lost] : stored[0] ?? lost[0];
        keep.push({ file_id: f.file_id, key, value });
        previous.push({ file_id: f.file_id, key, value: meta?.[key] ?? null });
      }
    }
    const apply = async () => {
      const ids: { property_id: string; value: string }[] = [];
      for (const c of conditions) {
        const cond = await findProperty(c.property);
        if (cond) ids.push({ property_id: cond.property_id, value: c.value });
      }
      if (keep.length > 0) await setMetadataCells(keep);
      await setPropertyScope(prop.property_id, ids);
      await afterPropertyChange();
    };
    try {
      await history.queue(apply);
    } catch (e) {
      setError(String(e));
      return;
    }
    history.push({
      label,
      undo: async () => {
        await setPropertyScope(prop.property_id, before);
        if (previous.length > 0) await setMetadataCells(previous);
        await afterPropertyChange();
      },
      redo: apply,
    });
  }

  /** "Applies to 3 of 12 files: 1 has a value, 2 to fill in." */
  function scopeSummary(name: string, conditions: ScopeCondition[]): string {
    const metas = rows.map((f) => f.metadata as Record<string, unknown> | null);
    const { withValue, expected, na } = scopeCoverage(metas, scopes, name, conditions, isListProperty);
    const count = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
    const total = withValue + expected + na;
    return `Applies to ${(withValue + expected).toLocaleString()} of ${count(total, "file")}: ${withValue.toLocaleString()} with a value, ${expected.toLocaleString()} to fill in.${
      conditions.length === 1 ? ` Files given a ${name} value also get “${conditions[0].value}”.` : ""
    }`;
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
    // Scoped: an empty cell is either expected (the property applies) or doesn't apply
    const scope = scopeOf(name);
    const fileImplied = impliedFor(file.file_id);
    const impliedHere = fileImplied[name] ?? [];
    const scopeCell =
      impliedHere.length > 0 ? "value" : scopeState(scope, file.metadata as Record<string, unknown> | null, fileImplied);
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
        onMouseDown={(e) => startCellDrag(e, ref)}
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
          ) : scopeCell === "expected" ? (
            <span
              title={describeScope(scope) ?? undefined}
              className="inline-flex items-center h-4 px-1.5 rounded border border-dashed border-neutral-500/60 text-[11px] leading-none text-neutral-500"
            >
              Choose…
            </span>
          ) : scopeCell === "na" ? (
            <span title={`Doesn't apply to this file · ${describeScope(scope)}`} className="text-neutral-600">
              —
            </span>
          ) : (
            <PropertyValueView
              value={value}
              type={type}
              config={config}
              // Any Select / Multi-select value can be dragged onto another list column
              onPillMouseDown={isList ? (e, v) => startTagDrag(e, v, { property: name }) : undefined}
              onPillContextMenu={isList ? (e, v) => showPillMenu(e, v, { property: name }) : undefined}
              wrap={isList && wraps(name)}
              implied={isList ? impliedHere : undefined}
              opens={isList ? (v) => opensInto(scopes, name, v) : undefined}
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
              onPillContextMenu={(e, tag) => showPillMenu(e, tag, "source")}
              wrap={wrapSourceTags}
              opens={(tag) => opensInto(scopes, null, tag)}
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
    // With the Rules panel open, the table keeps to the space beside it (so every column can be scrolled into view)
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative" style={rulesOpen ? { paddingRight: `min(${rulesWidth}px, calc(100% - 280px))` } : undefined}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-700/60 shrink-0">
        <span className="flex-1 min-w-0 truncate whitespace-nowrap text-neutral-500 text-xs">
          {/* The table's own count line carries the selection, rather than the toolbar */}
          {selectionLabel({ selected: selectedFiles, total: matched.length }) ??
            (ruleFocus
              ? `${matched.length.toLocaleString()} ${matched.length === 1 ? "file matches" : "files match"} “${ruleFocus.name}”`
              : matched.length === rows.length
                ? `${matched.length.toLocaleString()} files`
                : `${matched.length.toLocaleString()} of ${rows.length.toLocaleString()} files`)}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={showViewMenu}
            title="Saved views of this location: filters, sorts, groups and columns"
            className={`${TOOLBAR_BUTTON} flex items-center gap-1 max-w-[220px] ${
              tableViews.active && !tableViews.active.is_default ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON_IDLE
            }`}
          >
            <SymbolIcon name="rectangle.stack" size={11} fallback="▤" />
            <span className="truncate">{tableViews.active?.name ?? "View"}</span>
            {tableViews.edited && <span className="text-neutral-500 shrink-0">— Edited</span>}
            <SymbolIcon name="chevron.down" size={8} fallback="▾" />
          </button>
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
          <button
            onClick={() => (rulesOpen ? setRulesOpen(false) : openRules(null))}
            title="Rules: set values on files that meet conditions, such as parts of their names"
            className={`${TOOLBAR_BUTTON} flex items-center gap-1 ${ruleList.some((x) => x.enabled) ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON_IDLE}`}
          >
            <SymbolIcon name="wand.and.stars" size={11} fallback="✦" />
            Rules
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
        className="flex-1 min-h-0 overflow-auto isolate outline-none"
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
            ) : col.id.startsWith(PROP_PREFIX) && scopeOrigin(scopeOf(propName(col.id)), tagsProperty) ? (
              <span className="truncate" title={describeScope(scopeOf(propName(col.id))) ?? undefined}>
                {col.label}
                <span className="text-neutral-500"> ‹ {scopeOrigin(scopeOf(propName(col.id)), tagsProperty)}</span>
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
          stored={listValues(storedMeta(editingList.ref.row)[propName(editingList.ref.col)])}
          impliedBy={(value) => impliedSourcesOf(editingList.ref.row, propName(editingList.ref.col), value)}
          // Implied values show ticked; unticking one asks before clearing what implies it
          value={effectiveValue(
            rowById.get(editingList.ref.row) ?? rows.find((f) => f.file_id === editingList.ref.row),
            propName(editingList.ref.col)
          )}
          multiple={typeOf(propName(editingList.ref.col)) === "array"}
          options={valuesFor(editingList.ref.col)}
          seed={editingList.seed}
          onDeleteValue={(value) => deleteListValue(editingList.ref.col, value)}
          onRenameValue={(from, to) => renameListValue(editingList.ref.col, from, to)}
          sourcesOf={(value) => sourcesOf(editingList.ref.col, value)}
          usage={(value) => valueUsage(editingList.ref.col, value)}
          onPreview={(value) => {
            // The picker's ticks are the values set directly; implied ones keep showing faded
            const name = propName(editingList.ref.col);
            const shown = listValues(coerceValue(value, typeOf(name), configOf(name)));
            setListPreview({
              file_id: editingList.ref.row,
              key: name,
              value: typeOf(name) === "array" ? (shown.length ? shown : null) : (shown[0] ?? null),
            });
          }}
          onCommit={(value, move, dropped) => {
            listMove.current = move;
            setListPreview(null);
            void commitListCell(editingList.ref, value, dropped);
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
          onMakeRule={() => {
            setPanel(null);
            openRules(definitionFromFilter(rules, match, search));
          }}
        />
      )}

      {rulesOpen && library && (
        <RulesPanel
          key={ruleDraftKey}
          width={rulesWidth}
          onResize={setRulesWidth}
          library={library}
          rules={ruleList}
          files={rows}
          env={ruleEnvHere}
          columns={filterColumns}
          properties={availableProperties.filter((n) => propByName.has(n)).map((n) => ({ name: n, type: typeOf(n) }))}
          valuesFor={valuesFor}
          draft={ruleDraft}
          viewFilter={viewFilterRule}
          onSave={saveRuleHere}
          onDelete={async (id) => {
            await deleteRule(id);
            await loadRules();
          }}
          onReorder={async (ids) => {
            await reorderRules(ids);
            await loadRules();
          }}
          onApplyNow={applyRuleNow}
          onCreateProperty={createPropertyForRule}
          onFocus={setRuleFocusStable}
          onClose={() => {
            setRulesOpen(false);
            setRuleFocus(null);
          }}
        />
      )}


      {removalPrompt && (
        <Dialog
          title={`Remove ${removalPrompt.values.map((v) => `“${v}”`).join(" and ")}?`}
          message={`${listNames(removalPrompt.cleared)} ${removalPrompt.cleared.length === 1 ? "depends" : "depend"} on it, so ${
            removalPrompt.cleared.length === 1 ? "its value" : "their values"
          } on this file will be cleared too.`}
          onCancel={() => {
            removalPrompt.resolve(false);
            setRemovalPrompt(null);
          }}
          onSubmit={() => {
            removalPrompt.resolve(true);
            setRemovalPrompt(null);
          }}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton
                onClick={() => {
                  removalPrompt.resolve(false);
                  setRemovalPrompt(null);
                }}
              >
                Cancel
              </DialogButton>
              <DialogButton variant="default" autoFocus>
                Remove
              </DialogButton>
            </>
          }
        />
      )}

      {viewNaming && (
        <Dialog
          title={viewNaming.mode === "new" ? "Save as New View" : "Rename View"}
          message={
            viewNaming.mode === "new"
              ? "A view keeps this table's filters, sorts, groups and columns, to come back to."
              : undefined
          }
          onCancel={() => setViewNaming(null)}
          onSubmit={() => void submitViewName()}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setViewNaming(null)}>Cancel</DialogButton>
              <DialogButton variant="default" disabled={!viewNaming.text.trim()}>
                {viewNaming.mode === "new" ? "Save" : "Rename"}
              </DialogButton>
            </>
          }
        >
          <div className="flex flex-col gap-1.5">
            <DialogField label="Name:">
              <input
                autoFocus
                value={viewNaming.text}
                onChange={(e) => setViewNaming({ ...viewNaming, text: e.target.value, error: undefined })}
                onFocus={(e) => e.currentTarget.select()}
                className={dialogTextField}
              />
            </DialogField>
            {viewNaming.error && <p className="pl-[80px] text-xs text-red-500">{viewNaming.error}</p>}
          </div>
        </Dialog>
      )}

      {deletingView && tableViews.active && (
        <Dialog
          title={`Delete “${tableViews.active.name}”?`}
          message="The view is removed. Files and their values aren't changed."
          onCancel={() => setDeletingView(false)}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setDeletingView(false)}>Cancel</DialogButton>
              <DialogButton
                variant="destructive"
                onClick={() => {
                  setDeletingView(false);
                  if (tableViews.active) tableViews.remove(tableViews.active.view_id).catch((e) => setError(String(e)));
                }}
              >
                Delete
              </DialogButton>
            </>
          }
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

      {dateFormatEditing && (
        <Dialog
          title={`Date format for “${dateFormatEditing.name}”`}
          message={
            <>
              Shown as <span className="font-medium">{formatDatePattern(new Date(), dateFormatEditing.pattern) || "…"}</span>. Use YYYY or YY
              for the year, MMMM, MMM, MM or M for the month, DD or D for the day, dddd or ddd for the weekday; put other words in
              [brackets].
            </>
          }
          onCancel={() => setDateFormatEditing(null)}
          onSubmit={() => {
            const { name, pattern } = dateFormatEditing;
            setDateFormatEditing(null);
            if (pattern.trim()) void changeType(name, "date", { dateFormat: `custom:${pattern}` });
          }}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setDateFormatEditing(null)}>Cancel</DialogButton>
              <DialogButton variant="default" disabled={!dateFormatEditing.pattern.trim()}>
                OK
              </DialogButton>
            </>
          }
        >
          <DialogField label="Format:">
            <input
              autoFocus
              value={dateFormatEditing.pattern}
              onChange={(e) => setDateFormatEditing({ ...dateFormatEditing, pattern: e.target.value })}
              spellCheck={false}
              className={`${dialogTextField} font-mono`}
            />
          </DialogField>
        </Dialog>
      )}

      {scopeEditing && (
        <ScopeDialog
          property={scopeEditing}
          initial={scopeOf(scopeEditing)?.conditions ?? []}
          // Select / Multi-select properties, except this one and any that depend on it (that would loop)
          properties={availableProperties.filter(
            (p) =>
              p !== scopeEditing && (typeOf(p) === "enum" || typeOf(p) === "array") && !dependsOn(scopes, p, scopeEditing)
          )}
          valuesFor={(p) => valuesFor(PROP_PREFIX + p)}
          summary={(conditions) => scopeSummary(scopeEditing, conditions)}
          onApply={(conditions) => {
            const name = scopeEditing;
            setScopeEditing(null);
            void changeScope(name, conditions, "Apply Only Where");
          }}
          onCancel={() => setScopeEditing(null)}
        />
      )}

      {promoting && (
        <Dialog
          title={
            availableProperties.includes(promoting.name.trim())
              ? `Link “${promoting.value}” to ${promoting.name.trim()}`
              : `Make a property from “${promoting.value}”`
          }
          message={
            availableProperties.includes(promoting.name.trim())
              ? `“${promoting.name.trim()}” already exists. It will apply where “${promoting.value}” is set, as well as anywhere it applies now.`
              : `The new property applies to files with “${promoting.value}”. Giving a file a value in it also gives it “${promoting.value}”.`
          }
          onCancel={() => setPromoting(null)}
          onSubmit={() => {
            const name = promoting.name.trim();
            if (!name) return;
            setPromoting(null);
            void promoteTag(promoting.value, promoting.source, name, promoting.type, promoting.at);
          }}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setPromoting(null)}>Cancel</DialogButton>
              <DialogButton variant="default" disabled={!promoting.name.trim()}>
                {availableProperties.includes(promoting.name.trim()) ? "Link" : "Make Property"}
              </DialogButton>
            </>
          }
        >
          <div className="flex flex-col gap-2.5">
            <DialogField label="Name:">
              <input
                autoFocus
                value={promoting.name}
                onChange={(e) => setPromoting({ ...promoting, name: e.target.value })}
                onFocus={(e) => e.currentTarget.select()}
                className={dialogTextField}
              />
            </DialogField>
            {!availableProperties.includes(promoting.name.trim()) && (
              <DialogField label="Type:">
                <select
                  value={promoting.type}
                  onChange={(e) => setPromoting({ ...promoting, type: e.target.value as "enum" | "array" })}
                  className={dialogTextField}
                >
                  <option value="enum">Select</option>
                  <option value="array">Multi-select</option>
                </select>
              </DialogField>
            )}
          </div>
        </Dialog>
      )}

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

/**
 * How many lines `items` take as wrapping pills in `width`, given each pill's
 * measured width. `extra` widens a pill (the "›" on values that open into a
 * scoped property).
 */
function pillLines(items: string[], width: number, widths: Map<string, number>, extra?: (item: string) => number): number {
  if (items.length === 0 || width <= 0) return 1;
  let lines = 1;
  let x = 0;
  for (const item of items) {
    const w = (widths.get(item) ?? 0) + (extra?.(item) ?? 0);
    // Slack for floating-point error only: widths are the layout's own
    if (x > 0 && x + 4 + w > width + 0.01) {
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
  onPillContextMenu,
  wrap,
  opens,
}: {
  tags: string[];
  covered: Set<string>;
  onPillMouseDown: (e: React.MouseEvent, tag: string) => void;
  onPillContextMenu: (e: React.MouseEvent, tag: string) => void;
  /** Shows every tag, wrapping onto more lines (the row grows to fit). */
  wrap: boolean;
  /** The scoped properties a tag opens into (once promoted), marked "›". */
  opens: (tag: string) => string[];
}) {
  if (tags.length === 0) return null;
  const shown = wrap ? tags : tags.slice(0, MAX_TAGS_SHOWN);
  const overflow = tags.length - shown.length;
  return (
    <div className={`flex items-center gap-x-1 ${wrap ? "flex-wrap gap-y-0.5" : "flex-nowrap overflow-hidden"}`}>
      {shown.map((tag, i) => {
        const into = opens(tag);
        const notes = [
          covered.has(tag) ? `“${tag}” is recorded in a property` : null,
          into.length > 0 ? `Opens into ${into.join(", ")}` : null,
        ].filter(Boolean);
        return (
          <span
            // A path can repeat a folder name ("2024/Q1/2024")
            key={`${i}:${tag}`}
            onMouseDown={(e) => onPillMouseDown(e, tag)}
            onContextMenu={(e) => onPillContextMenu(e, tag)}
            title={notes.length > 0 ? notes.join(" · ") : undefined}
            className={`${PILL_CLASS} bg-neutral-500/15 text-neutral-300 data-[pressed]:bg-blue-500 data-[pressed]:text-white data-[pressed]:opacity-100 ${
              covered.has(tag) ? "opacity-40" : ""
            }`}
          >
            {tag}
            {into.length > 0 && <span className={PILL_MARK_CLASS}>›</span>}
          </span>
        );
      })}
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
  box: { left: number; top: number; width: number; height: number; line?: boolean } | null;
  hint: string;
}) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]">
      {box && (
        <div
          className={box.line ? "absolute rounded-full bg-blue-500" : "absolute rounded-md border-2 border-blue-500 bg-blue-500/10"}
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
