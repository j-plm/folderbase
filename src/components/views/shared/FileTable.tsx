import { useMemo } from "react";
import type React from "react";
import { useScrollAheadVirtualizer } from "../../../hooks/useScrollAheadVirtualizer";
import { FileIcon, FolderIcon } from "../../../lib/fileIcons";
import { folderItemId, type FolderEntry } from "../../../lib/folderTree";
import CloudBadge from "./CloudBadge";
import { useSelection } from "../../../hooks/useSelection";
import type { ColumnDef } from "../../../lib/columns";
import {
  fileName,
  formatFinderDate,
  formatFinderSize,
  groupFiles,
  kindLabel,
  type SortKey,
} from "../../../lib/arrange";
import { arrangementMenu, useArrangedBy, useArrangement, useGroupProperties } from "../../../contexts/ArrangementContext";
import { ARRANGED_GROUPS } from "../../../lib/fileDrag";
import { showContextMenu, withLead, type MenuEntry } from "../../../lib/nativeMenu";
import { measureText, uiFont } from "../../../lib/textMeasure";
import { useColumnLayout } from "../../../hooks/useColumnLayout";
import type { FileRecord } from "../../../types";
import TableHeader from "./TableHeader";
import { useFileDrag } from "../../../contexts/FileDragContext";
import type { DragItem } from "../../../lib/filing";
import { dragItemsFor } from "../../../lib/fileDrag";

// Finder's list view column order.
const COLUMNS: ColumnDef[] = [
  { id: "name", label: "Name", weight: 4, minWidth: 160 },
  { id: "modified", label: "Date Modified", weight: 1.6, minWidth: 110 },
  { id: "size", label: "Size", weight: 1, minWidth: 70, align: "right" },
  { id: "kind", label: "Kind", weight: 1.6, minWidth: 100 },
];

function cellText(file: FileRecord, key: string): string {
  switch (key) {
    case "name":
      return fileName(file.file_path);
    case "modified":
      return formatFinderDate(file.modified_at ?? file.timestamp);
    case "size":
      return formatFinderSize(file.file_size);
    case "kind":
      return kindLabel(file);
    default:
      return "";
  }
}

/** A virtual folder's cells, as Finder shows a folder's: no date or size of its own. */
const FOLDER_CELLS: Record<string, string> = { modified: "--", size: "--", kind: "Folder" };

// Finder list metrics (macOS 26): 20pt rows, 16pt icons, rounded stripes inset 10px.
const ROW_HEIGHT = 20;
const ICON_SIZE = 16;
const ICON_GAP = 6;
const INSET = 10;
const NAME_ICON_WIDTH = ICON_SIZE + ICON_GAP;

const CELL = "shrink-0 px-3 truncate whitespace-nowrap";
/** Group heading height (Finder's h-14 headings). */
const GROUP_HEADING_HEIGHT = 56;

/**
 * A line of the list: a group heading, or a folder or file with its neighbours
 * in the group (for joined selections).
 */
type ListItem =
  /** `value`: grouped by a property, the value the group stands for. */
  | { kind: "heading"; label: string; value?: string }
  | { kind: "row"; id: string; file?: FileRecord; folder?: FolderEntry; stripe: boolean; prev?: string; next?: string };

interface Props {
  files: FileRecord[];
  /** Persists this table's column widths separately from other tables. */
  storageKey: string;
  /** The view's folders here, listed before the files. */
  folders?: FolderEntry[];
  /** Opens a folder (by its value). */
  onOpenFolder?: (value: string) => void;
  /** A folder's right-click menu (by its value). */
  folderMenu?: (value: string) => MenuEntry[];
  /** Entries before the arrangement items when empty space is right-clicked (New Folder). */
  backgroundMenu?: () => MenuEntry[];
  /** The folder showing (its path), for filing by drag: what's dragged comes from here, and drops on empty space go here. */
  place?: string[];
  /** Where a folder (by its value) takes what's dropped on it. */
  folderPath?: (value: string) => string[];
  /** A right-click on files: the menu for those (the selection, or the file clicked). */
  fileMenu?: (items: DragItem[]) => MenuEntry[];
}

const NO_FOLDERS: FolderEntry[] = [];

/** Finder-style list of files: fitted, resizable, sortable columns. */
export default function FileTable({
  files,
  storageKey,
  folders = NO_FOLDERS,
  onOpenFolder,
  folderMenu,
  backgroundMenu,
  place,
  folderPath,
  fileMenu,
}: Props) {
  const drag = useFileDrag();
  const arrangementCtx = useArrangement();
  const { arrangement, toggleSortKey } = arrangementCtx;
  const { arrangement: arranged, byProperty, groupsTakeDrops } = useArrangedBy();
  const groupProperties = useGroupProperties();
  const layout = useColumnLayout(COLUMNS, storageKey, (key) => {
    const font = uiFont(13);
    const extra = key === "name" ? NAME_ICON_WIDTH : 0;
    const folderText = key === "name" ? folders.map((f) => f.label) : folders.length > 0 ? [FOLDER_CELLS[key] ?? ""] : [];
    return [...folderText.map((t) => measureText(t, font) + extra), ...files.map((f) => measureText(cellText(f, key), font) + extra)];
  }, INSET);

  const fileGroups = useMemo(() => groupFiles(files, arranged, undefined, byProperty), [files, arranged, byProperty]);
  const shown = useMemo(() => fileGroups.flatMap((g) => g.files), [fileGroups]);
  // The folders come first, in their level's order; with the files grouped, under their own heading
  const items = useMemo(() => {
    const groups: { label: string | null; value?: string; rows: { id: string; file?: FileRecord; folder?: FolderEntry }[] }[] =
      fileGroups.map((g) => ({ label: g.label, value: g.value, rows: g.files.map((file) => ({ id: file.file_id, file })) }));
    if (folders.length > 0) {
      const grouped = groups.some((g) => g.label);
      groups.unshift({ label: grouped ? "Folders" : null, rows: folders.map((f) => ({ id: folderItemId(f.value), folder: f })) });
    }
    return groups.flatMap((g): ListItem[] => [
      ...(g.label ? [{ kind: "heading" as const, label: g.label, value: g.value }] : []),
      ...g.rows.map((row, i) => ({
        kind: "row" as const,
        ...row,
        stripe: i % 2 === 1,
        prev: g.rows[i - 1]?.id,
        next: g.rows[i + 1]?.id,
      })),
    ]);
  }, [fileGroups, folders]);
  const itemIndex = useMemo(
    () => new Map(items.flatMap((item, i) => (item.kind === "row" ? [[item.id, i] as const] : []))),
    [items]
  );
  const folderIds = useMemo(() => folders.map((f) => folderItemId(f.value)), [folders]);
  const valueOfFolder = useMemo(() => new Map(folders.map((f) => [folderItemId(f.value), f.value])), [folders]);
  // Only the rows on screen are rendered, so thousands of files stay quick
  const virtualizer = useScrollAheadVirtualizer({
    count: items.length,
    getScrollElement: () => layout.container,
    estimateSize: (i) => (items[i].kind === "heading" ? GROUP_HEADING_HEIGHT : ROW_HEIGHT),
    overscan: 20,
  });
  const selection = useSelection(shown, {
    arrowKeys: true,
    onReveal: (_index, id) => {
      const i = itemIndex.get(id);
      if (i != null) virtualizer.scrollToIndex(i);
    },
    folders: folderIds,
    onOpenFolder: (id) => {
      const value = valueOfFolder.get(id);
      if (value != null) onOpenFolder?.(value);
    },
  });

  /** The rows a drag or right-click on `id` acts on: files from here, folders as themselves. */
  function itemsAt(id: string): DragItem[] {
    if (!place || !folderPath) return [];
    return dragItemsFor(selection.targetIds(id), files, place, (fid) => {
      const value = valueOfFolder.get(fid);
      return value == null ? null : folderPath(value);
    });
  }
  const pressRow = (e: React.PointerEvent, id: string) => drag?.press(e, () => itemsAt(id));

  function handleHeaderMenu(e: React.MouseEvent) {
    e.preventDefault();
    showContextMenu([{ type: "item", text: "Size All Columns to Fit", action: layout.fitAll }]);
  }

  const width = (id: string) => ({ width: layout.widths[id] });

  return (
    <div
      ref={layout.setContainer}
      {...(place && folderPath ? { "data-drop-path": JSON.stringify(place), "data-drop-kind": "area" } : {})}
      tabIndex={0}
      data-browse-keys
      onKeyDown={selection.onKeyDown}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("[data-table-header]")) selection.clear();
      }}
      className="flex-1 overflow-auto isolate pb-2 outline-none"
    >
      <TableHeader
        columns={COLUMNS}
        widths={layout.widths}
        contentWidth={layout.contentWidth}
        sort={arrangement.sort}
        onSort={(key) => toggleSortKey(key as SortKey)}
        onResizeStart={layout.startResize}
        onResetColumn={layout.resetColumn}
        onContextMenu={handleHeaderMenu}
        inset={INSET}
      />
      <div
        className="min-h-full"
        style={{ paddingLeft: INSET, paddingRight: INSET }}
        onContextMenu={(e) => {
          e.preventDefault();
          showContextMenu(withLead(backgroundMenu?.() ?? [], arrangementMenu(arrangementCtx, groupProperties)));
        }}
      >
        <div style={{ height: virtualizer.getTotalSize(), width: layout.contentWidth, position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => {
            const item = items[v.index];
            const place: React.CSSProperties = {
              position: "absolute",
              top: 0,
              left: 0,
              width: layout.contentWidth,
              height: v.size,
              transform: `translateY(${v.start}px)`,
            };
            if (item.kind === "heading") {
              return (
                <div
                  key={v.key}
                  style={place}
                  // Grouped by a property of one value: dropping on the heading gives files its value
                  {...(groupsTakeDrops && item.value != null
                    ? { "data-drop-path": JSON.stringify([item.value]), "data-drop-source": ARRANGED_GROUPS }
                    : {})}
                  className="flex items-end px-3 pb-1.5 text-[13px] font-medium text-neutral-500"
                >
                  {item.label}
                </div>
              );
            }
            const { file, folder } = item;
            const isSelected = selection.isSelected(item.id);
            // Adjacent selected rows join into one block, as in Finder
            const joinsAbove = isSelected && selection.isSelected(item.prev);
            const joinsBelow = isSelected && selection.isSelected(item.next);
            return (
              <div
                key={v.key}
                data-file-id={file?.file_id}
                data-drop-path={folder && folderPath ? JSON.stringify(folderPath(folder.value)) : undefined}
                onPointerDown={(e) => pressRow(e, item.id)}
                onClick={(e) => selection.onItemClick(e, item.id)}
                onDoubleClick={(e) => selection.onItemDoubleClick(e, item.id)}
                onContextMenu={(e) => {
                  const entries = folder ? folderMenu?.(folder.value) : fileMenu?.(itemsAt(item.id));
                  if (!entries || entries.length === 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  showContextMenu(entries, { event: e });
                }}
                style={place}
                className={`flex items-center rounded-md text-body cursor-default ${
                  joinsAbove ? "rounded-t-none" : ""
                } ${joinsBelow ? "rounded-b-none" : ""} ${
                  isSelected ? "native-selected" : item.stripe ? "bg-neutral-850" : ""
                }`}
              >
                <div
                  style={{ ...width("name"), gap: ICON_GAP }}
                  className={`${CELL} flex items-center text-neutral-100`}
                  title={folder ? `${folder.count.toLocaleString()} ${folder.count === 1 ? "file" : "files"}` : undefined}
                >
                  {file ? (
                    <FileIcon path={file.file_path} mimeType={file.file_type} size={ICON_SIZE} />
                  ) : (
                    <FolderIcon size={ICON_SIZE} />
                  )}
                  <span className="truncate">{file ? fileName(file.file_path) : folder?.label}</span>
                  {file && <CloudBadge show={file.online_only} className="ml-auto" />}
                </div>
                <div style={width("modified")} className={`${CELL} text-neutral-400`}>
                  {file ? formatFinderDate(file.modified_at ?? file.timestamp) : FOLDER_CELLS.modified}
                </div>
                <div style={width("size")} className={`${CELL} text-right text-neutral-400`}>
                  {file ? formatFinderSize(file.file_size) : FOLDER_CELLS.size}
                </div>
                <div style={width("kind")} className={`${CELL} text-neutral-400`}>
                  {file ? kindLabel(file) : FOLDER_CELLS.kind}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {files.length === 0 && folders.length === 0 && (
        <div className="px-3 py-8 text-center text-neutral-500 text-sm">No files</div>
      )}
    </div>
  );
}
