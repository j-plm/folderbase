import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import {
  getLocationProperties,
  getMappingNodes,
  ingestDirectory,
} from "../../lib/commands";
import type { FileRecord } from "../../types";
import PathMappingPanel from "../mapping/PathMappingPanel";
import { FileIcon } from "../../lib/fileIcons";
import { formatFinderDate, formatFinderSize } from "../../lib/arrange";
import {
  compareSortValues,
  moveColumnId,
  orderColumns,
  toggleSort,
  type ColumnDef,
  type SortState,
} from "../../lib/columns";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import OverflowBar from "../shell/OverflowBar";
import { measureText, uiFont } from "../../lib/textMeasure";
import { useColumnLayout } from "../../hooks/useColumnLayout";
import TableHeader from "./shared/TableHeader";

interface Props {
  files: FileRecord[];
  locationId: string;
  onMappingChanged?: () => void;
}

interface IndexingProgress {
  location_id: string;
  files_scanned: number;
  done: boolean;
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
  { id: "name", label: "Name", weight: 3, minWidth: 140, reorderable: false },
  { id: "ext", label: "Ext", weight: 0.6, minWidth: 50 },
  { id: "path", label: "Path", weight: 4, minWidth: 120 },
  { id: "type", label: "Type", weight: 1.4, minWidth: 90 },
  { id: "size", label: "Size", weight: 0.9, minWidth: 70, align: "right" },
  { id: "created", label: "Created", weight: 1.2, minWidth: 100 },
  { id: "modified", label: "Modified", weight: 1.2, minWidth: 100 },
];
const TAGS_COLUMN: ColumnDef = { id: "tags", label: "Tags", weight: 2, minWidth: 120, sortable: false };
const PROP_PREFIX = "prop:";

function propertyColumn(name: string): ColumnDef {
  return { id: PROP_PREFIX + name, label: name, weight: 1.4, minWidth: 90 };
}

function sortValue(file: FileRecord, key: string): string | number | null | undefined {
  if (key.startsWith(PROP_PREFIX)) {
    const value = (file.metadata as Record<string, unknown> | null)?.[key.slice(PROP_PREFIX.length)];
    return value == null ? null : String(value);
  }
  switch (key) {
    case "name":
      return fileName(file.file_path);
    case "ext":
      return fileExtension(file.file_path);
    case "path":
      return file.relative_path ?? file.file_path;
    case "type":
      return file.file_type;
    case "size":
      return file.file_size;
    case "created":
      return file.timestamp;
    case "modified":
      return file.modified_at;
    default:
      return null;
  }
}

/** Rendered width of a cell's content, for double-click-to-fit. */
function measureCell(file: FileRecord, key: string): number {
  if (key === "tags") {
    const tags = Array.isArray(file.tags) ? file.tags : [];
    const shown = tags.slice(0, MAX_TAGS_SHOWN);
    const pills = [...shown];
    if (tags.length > MAX_TAGS_SHOWN) pills.push(`+${tags.length - MAX_TAGS_SHOWN}`);
    const pillFont = uiFont(11);
    // each pill: text + px-1.5 padding; gap-1 between pills
    return pills.reduce((sum, p, i) => sum + measureText(p, pillFont) + 12 + (i > 0 ? 4 : 0), 0);
  }
  const body = uiFont(13);
  if (key === "name") return measureText(fileName(file.file_path), body) + 22; // icon + gap
  if (key.startsWith(PROP_PREFIX)) {
    const value = (file.metadata as Record<string, unknown> | null)?.[key.slice(PROP_PREFIX.length)];
    return measureText(value != null ? String(value) : "—", body);
  }
  const text: Record<string, string> = {
    ext: fileExtension(file.file_path),
    path: file.relative_path ?? file.file_path,
    type: file.file_type ?? "",
    size: formatFinderSize(file.file_size),
    created: formatFinderDate(file.timestamp),
    modified: formatFinderDate(file.modified_at),
  };
  return measureText(text[key] ?? "", body);
}

const CELL = "shrink-0 px-3 truncate whitespace-nowrap";
// Finder list metrics: 20pt rows, rounded stripes inset 10px.
const ROW_HEIGHT = 20;
const INSET = 10;

const TOOLBAR_BUTTON = "px-2.5 py-1 text-xs rounded-md border whitespace-nowrap transition-colors";
const TOOLBAR_BUTTON_IDLE = "border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600";
const TOOLBAR_BUTTON_ACTIVE = "border-blue-500/60 text-blue-400 hover:text-blue-300 hover:border-blue-400";
const DEFAULT_SORT: SortState = { key: "path", direction: "asc" };

export default function LocationDatabaseView({ files, locationId, onMappingChanged }: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [indexing, setIndexing] = useState<{
    scanned: number;
    done: boolean;
  } | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexError, setReindexError] = useState<string | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [hasMappings, setHasMappings] = useState(false);

  // Column visibility
  const [hiddenStandard, setHiddenStandard] = useState<string[]>([]);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [visibleProperties, setVisibleProperties] = useState<string[]>([]);
  const [availableProperties, setAvailableProperties] = useState<string[]>([]);

  // Reset view state and load column prefs when switching locations
  useEffect(() => {
    setSearch("");
    setSort(DEFAULT_SORT);
    setSelectedId(null);
    setIndexing(null);
    setReindexing(false);
    setReindexError(null);
    setMappingOpen(false);

    const savedTags =
      localStorage.getItem(`col-tags-${locationId}`) === "true";
    let savedProps: string[] = [];
    let savedHidden: string[] = [];
    let savedOrder: string[] = [];
    try {
      savedProps = JSON.parse(
        localStorage.getItem(`col-props-${locationId}`) ?? "[]"
      );
      savedHidden = JSON.parse(
        localStorage.getItem(`col-hidden-${locationId}`) ?? "[]"
      );
      savedOrder = JSON.parse(
        localStorage.getItem(`col-order-${locationId}`) ?? "[]"
      );
    } catch {}
    setShowTags(savedTags);
    setVisibleProperties(savedProps);
    setHiddenStandard(savedHidden);
    setColumnOrder(savedOrder);
  }, [locationId]);

  useEffect(() => {
    getMappingNodes(locationId)
      .then((nodes) => setHasMappings(nodes.length > 0))
      .catch(() => {});
  }, [locationId]);

  useEffect(() => {
    getLocationProperties(locationId)
      .then((props) => {
        setAvailableProperties(props);
        setVisibleProperties((prev) => prev.filter((p) => props.includes(p)));
      })
      .catch(() => {});
  }, [locationId]);

  // Progress banner + refresh available properties after reindex
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<IndexingProgress>("indexing_progress", (event) => {
      const p = event.payload;
      if (p.location_id !== locationId) return;
      setIndexing({ scanned: p.files_scanned, done: p.done });
      if (p.done) {
        setReindexing(false);
        setTimeout(() => setIndexing(null), 2500);
        getLocationProperties(locationId)
          .then((props) => {
            setAvailableProperties(props);
            setVisibleProperties((prev) => prev.filter((p) => props.includes(p)));
          })
          .catch(() => {});
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [locationId]);

  async function handleReindex() {
    setReindexing(true);
    setReindexError(null);
    setIndexing({ scanned: 0, done: false });
    try {
      await ingestDirectory(locationId);
    } catch (e) {
      setReindexError(String(e));
      setReindexing(false);
      setIndexing(null);
    }
  }

  function toggleStandard(id: string) {
    if (id === "name") return;
    const next = hiddenStandard.includes(id)
      ? hiddenStandard.filter((c) => c !== id)
      : [...hiddenStandard, id];
    setHiddenStandard(next);
    localStorage.setItem(`col-hidden-${locationId}`, JSON.stringify(next));
  }

  function toggleShowTags() {
    const next = !showTags;
    setShowTags(next);
    localStorage.setItem(`col-tags-${locationId}`, String(next));
  }

  function toggleProperty(name: string) {
    const next = visibleProperties.includes(name)
      ? visibleProperties.filter((p) => p !== name)
      : [...visibleProperties, name];
    setVisibleProperties(next);
    localStorage.setItem(`col-props-${locationId}`, JSON.stringify(next));
  }

  const columns = useMemo(
    () =>
      orderColumns(
        [
          ...STANDARD_COLUMNS.filter((c) => !hiddenStandard.includes(c.id)),
          ...(showTags ? [TAGS_COLUMN] : []),
          ...visibleProperties.map(propertyColumn),
        ],
        columnOrder
      ),
    [hiddenStandard, showTags, visibleProperties, columnOrder]
  );

  function handleReorder(columnId: string, targetIndex: number) {
    const visibleIds = moveColumnId(columns.map((c) => c.id), columnId, targetIndex);
    // Keep saved positions of currently hidden columns after the visible ones.
    const next = [...visibleIds, ...columnOrder.filter((id) => !visibleIds.includes(id))];
    setColumnOrder(next);
    localStorage.setItem(`col-order-${locationId}`, JSON.stringify(next));
  }
  const layout = useColumnLayout(
    columns,
    `db-${locationId}`,
    (key) => files.map((f) => measureCell(f, key)),
    INSET
  );

  function columnMenuEntries(): MenuEntry[] {
    return [
      ...STANDARD_COLUMNS.map((c) => ({
        type: "check" as const,
        text: c.label,
        checked: !hiddenStandard.includes(c.id),
        enabled: c.id !== "name",
        action: () => toggleStandard(c.id),
      })),
      { type: "separator" },
      { type: "check", text: "Tags", checked: showTags, action: toggleShowTags },
      ...availableProperties.map((name) => ({
        type: "check" as const,
        text: name,
        checked: visibleProperties.includes(name),
        action: () => toggleProperty(name),
      })),
      { type: "separator" },
      { type: "item", text: "Size All Columns to Fit", action: layout.fitAll },
    ];
  }

  function handleHeaderMenu(e: React.MouseEvent) {
    e.preventDefault();
    showContextMenu(columnMenuEntries());
  }

  const filtered = files.filter((f) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = fileName(f.file_path).toLowerCase();
    const rel = (f.relative_path ?? "").toLowerCase();
    return name.includes(q) || rel.includes(q);
  });

  const sorted = [...filtered].sort((a, b) =>
    compareSortValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.direction)
  );

  const extraColCount = (showTags ? 1 : 0) + visibleProperties.length;

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => layout.container,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  function renderCell(col: ColumnDef, file: FileRecord) {
    const style = { width: layout.widths[col.id] };
    if (col.id.startsWith(PROP_PREFIX)) {
      const value = (file.metadata as Record<string, unknown> | null)?.[col.id.slice(PROP_PREFIX.length)];
      return (
        <div key={col.id} style={style} className={`${CELL} ${value != null ? "text-neutral-100" : "text-neutral-500"}`}>
          {value != null ? String(value) : "—"}
        </div>
      );
    }
    switch (col.id) {
      case "name":
        return (
          <div key={col.id} style={style} className={`${CELL} flex items-center gap-1.5 text-neutral-100`}>
            <FileIcon path={file.file_path} mimeType={file.file_type} size={16} />
            <span className="truncate">{fileName(file.file_path)}</span>
          </div>
        );
      case "ext":
        return <div key={col.id} style={style} className={`${CELL} text-neutral-400`}>{fileExtension(file.file_path)}</div>;
      case "path":
        return (
          <div key={col.id} style={style} className={`${CELL} text-neutral-400`} title={file.relative_path ?? file.file_path}>
            {file.relative_path ?? file.file_path}
          </div>
        );
      case "type":
        return <div key={col.id} style={style} className={`${CELL} text-neutral-400`}>{file.file_type ?? ""}</div>;
      case "size":
        return <div key={col.id} style={style} className={`${CELL} text-right text-neutral-400`}>{formatFinderSize(file.file_size)}</div>;
      case "created":
        return <div key={col.id} style={style} className={`${CELL} text-neutral-400`}>{formatFinderDate(file.timestamp)}</div>;
      case "modified":
        return <div key={col.id} style={style} className={`${CELL} text-neutral-400`}>{formatFinderDate(file.modified_at)}</div>;
      case "tags":
        return (
          <div key={col.id} style={style} className={`${CELL} flex items-center`}>
            <TagPills tags={Array.isArray(file.tags) ? file.tags : []} />
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-700/60 shrink-0">
        <span className="flex-1 min-w-0 truncate whitespace-nowrap text-neutral-500 text-xs">
          {sorted.length.toLocaleString()} files
        </span>
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
                  onClick={() => setMappingOpen(true)}
                  className={`${TOOLBAR_BUTTON} ${hasMappings ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON_IDLE}`}
                >
                  {hasMappings ? "● Map Structure" : "Map Structure"}
                </button>
              ),
              menu: [{ type: "item", text: "Map Structure…", action: () => setMappingOpen(true) }],
            },
            {
              id: "reindex",
              node: (
                <button
                  onClick={handleReindex}
                  disabled={reindexing}
                  className={`${TOOLBAR_BUTTON} ${TOOLBAR_BUTTON_IDLE} disabled:opacity-50`}
                >
                  {reindexing ? "Indexing…" : "Re-index"}
                </button>
              ),
              menu: [{ type: "item", text: "Re-index", enabled: !reindexing, action: handleReindex }],
            },
            {
              id: "columns",
              node: (
                <button
                  onClick={() => showContextMenu(columnMenuEntries())}
                  className={`${TOOLBAR_BUTTON} ${extraColCount > 0 ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON_IDLE}`}
                >
                  {extraColCount > 0 ? `Columns (${extraColCount})` : "Columns"}
                </button>
              ),
              menu: [{ type: "submenu", text: "Columns", items: columnMenuEntries() }],
            },
          ]}
        />
      </div>

      {reindexError && (
        <div className="px-4 py-2 bg-red-950/40 text-red-400 text-xs border-b border-red-900/40 shrink-0">
          {reindexError}
        </div>
      )}
      {indexing && !indexing.done && (
        <div className="px-4 py-2 bg-blue-950/40 text-blue-300 text-xs border-b border-blue-900/40 shrink-0">
          Indexing… {indexing.scanned.toLocaleString()} files scanned
        </div>
      )}
      {indexing && indexing.done && (
        <div className="px-4 py-2 bg-green-950/40 text-green-300 text-xs border-b border-green-900/40 shrink-0">
          {indexing.scanned.toLocaleString()} files indexed
        </div>
      )}

      {/* Table: one scroll container, sticky header, virtualised rows */}
      <div ref={layout.setContainer} className="flex-1 min-h-0 overflow-auto">
        <TableHeader
          columns={columns}
          widths={layout.widths}
          contentWidth={layout.contentWidth}
          sort={sort}
          onSort={(key) => setSort((s) => toggleSort(s, key))}
          onResizeStart={layout.startResize}
          onResetColumn={layout.resetColumn}
          onContextMenu={handleHeaderMenu}
          onReorder={handleReorder}
          inset={INSET}
        />
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-neutral-500 text-sm">
            {files.length === 0
              ? indexing && !indexing.done
                ? "Indexing…"
                : "No files indexed. Try Re-index."
              : "No files match your search"}
          </div>
        ) : (
          <div style={{ paddingLeft: INSET, paddingRight: INSET }}>
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: layout.contentWidth,
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const file = sorted[virtualRow.index];
                const isSelected = file.file_id === selectedId;
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
                    }}
                    onClick={() =>
                      setSelectedId(isSelected ? null : file.file_id)
                    }
                    className={`flex items-center rounded-md text-body cursor-default ${
                      isSelected
                        ? "native-selected"
                        : virtualRow.index % 2 === 1
                          ? "bg-neutral-850"
                          : ""
                    }`}
                  >
                    {columns.map((col) => renderCell(col, file))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {mappingOpen && (
        <PathMappingPanel
          locationId={locationId}
          onClose={() => {
            setMappingOpen(false);
            getMappingNodes(locationId)
              .then((nodes) => setHasMappings(nodes.length > 0))
              .catch(() => {});
            getLocationProperties(locationId)
              .then((props) => {
                setAvailableProperties(props);
                setVisibleProperties((prev) => prev.filter((p) => props.includes(p)));
              })
              .catch(() => {});
            onMappingChanged?.();
          }}
        />
      )}
    </div>
  );
}

const MAX_TAGS_SHOWN = 4;

function TagPills({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, MAX_TAGS_SHOWN);
  const overflow = tags.length - MAX_TAGS_SHOWN;
  return (
    <div className="flex flex-nowrap items-center gap-1 overflow-hidden">
      {shown.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center h-4 px-1.5 rounded text-[11px] leading-none whitespace-nowrap shrink-0 bg-neutral-500/15 text-neutral-300"
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
