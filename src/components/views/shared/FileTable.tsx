import { Fragment, useMemo, useState } from "react";
import type React from "react";
import { FileIcon } from "../../../lib/fileIcons";
import { openPath } from "../../../lib/commands";
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

interface Props {
  files: FileRecord[];
  /** Persists this table's column widths separately from other tables. */
  storageKey: string;
}

/** Finder-style list of files: fitted, resizable, sortable columns. */
export default function FileTable({ files, storageKey }: Props) {
  const arrangementCtx = useArrangement();
  const { arrangement, toggleSortKey } = arrangementCtx;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const layout = useColumnLayout(COLUMNS, storageKey, (key) => {
    const font = uiFont(13);
    const extra = key === "name" ? NAME_ICON_WIDTH : 0;
    return files.map((f) => measureText(cellText(f, key), font) + extra);
  }, INSET);

  const groups = useMemo(() => groupFiles(files, arrangement), [files, arrangement]);

  async function handleOpen(filePath: string) {
    try {
      await openPath(filePath);
    } catch {
      // ignore
    }
  }

  function handleHeaderMenu(e: React.MouseEvent) {
    e.preventDefault();
    showContextMenu([{ type: "item", text: "Size All Columns to Fit", action: layout.fitAll }]);
  }

  const width = (id: string) => ({ width: layout.widths[id] });

  return (
    <div ref={layout.setContainer} className="flex-1 overflow-auto pb-2">
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
        {groups.map((group) => (
          <Fragment key={group.label}>
            {group.label && (
              <div
                style={{ width: layout.contentWidth }}
                className="flex items-end h-14 px-3 pb-1.5 text-[13px] font-medium text-neutral-500"
              >
                {group.label}
              </div>
            )}
            {group.files.map((file, i) => {
              const isSelected = file.file_id === selectedId;
              return (
                <div
                  key={file.file_id}
                  onClick={() => setSelectedId(file.file_id)}
                  onDoubleClick={() => handleOpen(file.file_path)}
                  style={{ width: layout.contentWidth, height: ROW_HEIGHT }}
                  className={`flex items-center rounded-md text-body cursor-default ${
                    isSelected ? "native-selected" : i % 2 === 1 ? "bg-neutral-850" : ""
                  }`}
                >
                  <div style={{ ...width("name"), gap: ICON_GAP }} className={`${CELL} flex items-center text-neutral-100`}>
                    <FileIcon path={file.file_path} mimeType={file.file_type} size={ICON_SIZE} />
                    <span className="truncate">{fileName(file.file_path)}</span>
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
          </Fragment>
        ))}
      </div>
      {files.length === 0 && (
        <div className="px-3 py-8 text-center text-neutral-500 text-sm">No files</div>
      )}
    </div>
  );
}
