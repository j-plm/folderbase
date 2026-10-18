import { useMemo } from "react";
import type React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileIcon } from "../../../lib/fileIcons";
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
import { arrangementMenu, useArrangement } from "../../../contexts/ArrangementContext";
import { showContextMenu } from "../../../lib/nativeMenu";
import { measureText, uiFont } from "../../../lib/textMeasure";
import { useColumnLayout } from "../../../hooks/useColumnLayout";
import type { FileRecord } from "../../../types";
import TableHeader from "./TableHeader";

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

// Finder list metrics (macOS 26): 20pt rows, 16pt icons, rounded stripes inset 10px.
const ROW_HEIGHT = 20;
const ICON_SIZE = 16;
const ICON_GAP = 6;
const INSET = 10;
const NAME_ICON_WIDTH = ICON_SIZE + ICON_GAP;

const CELL = "shrink-0 px-3 truncate whitespace-nowrap";
/** Group heading height (Finder's h-14 headings). */
const GROUP_HEADING_HEIGHT = 56;

/** A line of the list: a group heading, or a file with its neighbours in the group (for joined selections). */
type ListItem =
  | { kind: "heading"; label: string }
  | { kind: "row"; file: FileRecord; stripe: boolean; prev?: string; next?: string };

interface Props {
  files: FileRecord[];
  /** Persists this table's column widths separately from other tables. */
  storageKey: string;
}

/** Finder-style list of files: fitted, resizable, sortable columns. */
export default function FileTable({ files, storageKey }: Props) {
  const arrangementCtx = useArrangement();
  const { arrangement, toggleSortKey } = arrangementCtx;
  const layout = useColumnLayout(COLUMNS, storageKey, (key) => {
    const font = uiFont(13);
    const extra = key === "name" ? NAME_ICON_WIDTH : 0;
    return files.map((f) => measureText(cellText(f, key), font) + extra);
  }, INSET);

  const groups = useMemo(() => groupFiles(files, arrangement), [files, arrangement]);
  const shown = useMemo(() => groups.flatMap((g) => g.files), [groups]);
  const items = useMemo(
    () =>
      groups.flatMap((g): ListItem[] => [
        ...(g.label ? [{ kind: "heading" as const, label: g.label }] : []),
        ...g.files.map((file, i) => ({
          kind: "row" as const,
          file,
          stripe: i % 2 === 1,
          prev: g.files[i - 1]?.file_id,
          next: g.files[i + 1]?.file_id,
        })),
      ]),
    [groups]
  );
  const itemIndex = useMemo(
    () => new Map(items.flatMap((item, i) => (item.kind === "row" ? [[item.file.file_id, i] as const] : []))),
    [items]
  );
  // Only the rows on screen are rendered, so thousands of files stay quick
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => layout.container,
    estimateSize: (i) => (items[i].kind === "heading" ? GROUP_HEADING_HEIGHT : ROW_HEIGHT),
    overscan: 20,
  });
  const selection = useSelection(shown, {
    arrowKeys: true,
    onReveal: (index) => {
      const i = itemIndex.get(shown[index]?.file_id);
      if (i != null) virtualizer.scrollToIndex(i);
    },
  });

  function handleHeaderMenu(e: React.MouseEvent) {
    e.preventDefault();
    showContextMenu([{ type: "item", text: "Size All Columns to Fit", action: layout.fitAll }]);
  }

  const width = (id: string) => ({ width: layout.widths[id] });

  return (
    <div
      ref={layout.setContainer}
      tabIndex={0}
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
          showContextMenu(arrangementMenu(arrangementCtx));
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
                <div key={v.key} style={place} className="flex items-end px-3 pb-1.5 text-[13px] font-medium text-neutral-500">
                  {item.label}
                </div>
              );
            }
            const { file } = item;
            const isSelected = selection.isSelected(file.file_id);
            // Adjacent selected rows join into one block, as in Finder
            const joinsAbove = isSelected && selection.isSelected(item.prev);
            const joinsBelow = isSelected && selection.isSelected(item.next);
            return (
              <div
                key={v.key}
                data-file-id={file.file_id}
                onClick={(e) => selection.onItemClick(e, file.file_id)}
                onDoubleClick={(e) => selection.onItemDoubleClick(e, file.file_id)}
                style={place}
                className={`flex items-center rounded-md text-body cursor-default ${
                  joinsAbove ? "rounded-t-none" : ""
                } ${joinsBelow ? "rounded-b-none" : ""} ${
                  isSelected ? "native-selected" : item.stripe ? "bg-neutral-850" : ""
                }`}
              >
                <div style={{ ...width("name"), gap: ICON_GAP }} className={`${CELL} flex items-center text-neutral-100`}>
                  <FileIcon path={file.file_path} mimeType={file.file_type} size={ICON_SIZE} />
                  <span className="truncate">{fileName(file.file_path)}</span>
                  <CloudBadge show={file.online_only} className="ml-auto" />
                </div>
                <div style={width("modified")} className={`${CELL} text-neutral-400`}>
                  {formatFinderDate(file.modified_at ?? file.timestamp)}
                </div>
                <div style={width("size")} className={`${CELL} text-right text-neutral-400`}>
                  {formatFinderSize(file.file_size)}
                </div>
                <div style={width("kind")} className={`${CELL} text-neutral-400`}>
                  {kindLabel(file)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {files.length === 0 && (
        <div className="px-3 py-8 text-center text-neutral-500 text-sm">No files</div>
      )}
    </div>
  );
}
