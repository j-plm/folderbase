import { useCallback, useEffect, useMemo, useRef } from "react";
import type React from "react";
import Thumbnail from "./shared/Thumbnail";
import CloudBadge from "./shared/CloudBadge";
import PreviewStage from "./shared/PreviewStage";
import { useSelection } from "../../hooks/useSelection";
import { gridNeighbor, type ArrowKey } from "../../lib/selection";
import { fileName, groupFiles } from "../../lib/arrange";
import { showContextMenu, withLead, type MenuEntry } from "../../lib/nativeMenu";
import { arrangementMenu, useArrangedBy, useArrangement } from "../../contexts/ArrangementContext";
import { FolderIcon } from "../../lib/fileIcons";
import { folderItemId as folderId, type FolderEntry } from "../../lib/folderTree";
import { useFileDrag } from "../../contexts/FileDragContext";
import type { DragItem } from "../../lib/filing";
import { dragItemsFor } from "../../lib/fileDrag";
import type { FileRecord } from "../../types";

interface Props {
  files: FileRecord[];
  /** The view's folders here, shown before the files. */
  folders?: FolderEntry[];
  /** Opens a folder (by its value): in place, with the path bar following. */
  onOpenFolder?: (value: string) => void;
  /** A folder's right-click menu (by its value). */
  folderMenu?: (value: string) => MenuEntry[];
  /** Entries before Sort By when empty space is right-clicked (New Folder). */
  backgroundMenu?: () => MenuEntry[];
  /** The folder showing (its path), for filing by drag. */
  place?: string[];
  /** Where a folder (by its value) takes what's dropped on it. */
  folderPath?: (value: string) => string[];
  /** A right-click on files, or on a selection with folders among them. */
  fileMenu?: (items: DragItem[]) => MenuEntry[];
}

const NO_FOLDERS: FolderEntry[] = [];

/** An item of the strip: a folder or a file. */
interface Item {
  id: string;
  name: string;
  file?: FileRecord;
  folder?: FolderEntry;
}

/** Strip thumbnails, as Finder's Gallery: 56pt pictures in 64pt cells. */
const THUMB = 56;
const CELL = 64;

/**
 * Finder's Gallery view (spec ▸ View Modes ▸ Gallery): the selected item
 * large, live where it can be (pages of a PDF, video and audio playing), above
 * a strip of thumbnails, folders first. ← and → move along the strip, Space is
 * Quick Look, double-click opens (a folder in place). Sort By applies; Group By
 * doesn't, as in Finder. Filing by drag works from the strip and from the
 * large preview. One item stays selected.
 */
export default function GalleryView({ files, folders = NO_FOLDERS, onOpenFolder, folderMenu, backgroundMenu, place, folderPath, fileMenu }: Props) {
  const drag = useFileDrag();
  const arrangementCtx = useArrangement();
  const { arrangement, byProperty } = useArrangedBy();
  // Sorted as chosen, never grouped
  const sorted = useMemo(
    () => groupFiles(files, { ...arrangement, groupBy: "none" }, undefined, byProperty).flatMap((g) => g.files),
    [files, arrangement, byProperty]
  );
  const items = useMemo(
    (): Item[] => [
      ...folders.map((f) => ({ id: folderId(f.value), name: f.label, folder: f })),
      ...sorted.map((f) => ({ id: f.file_id, name: fileName(f.file_path), file: f })),
    ],
    [folders, sorted]
  );
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const folderIds = useMemo(() => folders.map((f) => folderId(f.value)), [folders]);

  // One row: ← and → step along it
  const boxes = useMemo(() => items.map((item, i) => ({ id: item.id, x: i * 100, y: 0 })), [items]);
  const gridNavigate = useCallback((fromId: string, key: ArrowKey) => gridNeighbor(boxes, fromId, key), [boxes]);

  const stripRef = useRef<HTMLDivElement>(null);
  const reveal = (id: string) =>
    stripRef.current?.querySelector(`[data-strip-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });

  const selection = useSelection(sorted, {
    gridNavigate,
    onReveal: (_index, id) => reveal(id),
    folders: folderIds,
    onOpenFolder: (id) => {
      const folder = byId.get(id)?.folder;
      if (folder) onOpenFolder?.(folder.value);
    },
  });

  // One item is always selected, as in Finder: the first, until another is chosen
  const { selectedIds, select } = selection;
  const first = items[0]?.id;
  useEffect(() => {
    if (selectedIds.length === 0 && first) select(first);
  }, [selectedIds.length, first, select]);
  const shown = byId.get(selectedIds[selectedIds.length - 1] ?? "") ?? null;

  const dropHere = place && folderPath ? { "data-drop-path": JSON.stringify(place), "data-drop-kind": "area" } : {};
  /** What a drag or right-click on `id` acts on: files from here, folders as themselves. */
  const itemsAt = (id: string): DragItem[] =>
    place && folderPath
      ? dragItemsFor(selection.targetIds(id), files, place, (fid) => {
          const folder = byId.get(fid)?.folder;
          return folder ? folderPath(folder.value) : null;
        })
      : [];
  const press = (e: React.PointerEvent, id: string) => drag?.press(e, () => itemsAt(id));
  const itemMenu = (e: React.MouseEvent, item: Item) => {
    // A folder alone has its own menu; in a selection with others, the selection's
    const acted = itemsAt(item.id);
    const entries = item.folder && acted.length <= 1 ? folderMenu?.(item.folder.value) : fileMenu?.(acted);
    if (!entries || entries.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(entries, { event: e });
  };
  const sortMenu = arrangementMenu(arrangementCtx).filter((entry) => entry.type === "submenu" && entry.text === "Sort By");

  if (items.length === 0) {
    return (
      <div {...dropHere} className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
        No files
      </div>
    );
  }

  return (
    <div
      {...dropHere}
      className="flex-1 min-h-0 flex flex-col"
      onContextMenu={(e) => {
        e.preventDefault();
        showContextMenu(withLead(backgroundMenu?.() ?? [], sortMenu));
      }}
    >
      {/* The selected item large; dragging it files it, as from the strip */}
      <div
        className="flex-1 min-h-0 flex flex-col px-8 pt-6 pb-3 select-none"
        onPointerDown={shown ? (e) => press(e, shown.id) : undefined}
        onDoubleClick={shown ? (e) => selection.onItemDoubleClick(e, shown.id) : undefined}
        onContextMenu={shown ? (e) => itemMenu(e, shown) : undefined}
      >
        {shown?.file && <PreviewStage key="file" file={shown.file} live fill max={2048} />}
        {shown?.folder && (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
            <FolderIcon size={256} />
            <p className="text-[13px] text-neutral-500">
              {shown.folder.count.toLocaleString()} {shown.folder.count === 1 ? "file" : "files"}
            </p>
          </div>
        )}
        {shown && <p className="shrink-0 mt-3 text-center text-[13px] font-semibold text-neutral-100 truncate">{shown.name}</p>}
      </div>

      <div
        ref={stripRef}
        tabIndex={0}
        data-browse-keys
        onKeyDown={selection.onKeyDown}
        className="shrink-0 flex items-center gap-1 px-4 py-2 overflow-x-auto overflow-y-hidden border-t border-neutral-700/60 outline-none"
      >
        {items.map((item) => {
          const selected = selection.isSelected(item.id);
          return (
            <div
              key={item.id}
              data-strip-id={item.id}
              data-file-id={item.file?.file_id}
              data-drop-path={item.folder && folderPath ? JSON.stringify(folderPath(item.folder.value)) : undefined}
              title={item.name}
              onPointerDown={(e) => press(e, item.id)}
              onClick={(e) => selection.onItemClick(e, item.id)}
              onDoubleClick={(e) => selection.onItemDoubleClick(e, item.id)}
              onContextMenu={(e) => itemMenu(e, item)}
              style={{ width: CELL, height: CELL }}
              className={`relative shrink-0 flex items-center justify-center rounded-md cursor-default select-none ${
                selected ? "bg-neutral-700/70 ring-2 ring-blue-500" : ""
              }`}
            >
              {item.file && <Thumbnail path={item.file.file_path} mimeType={item.file.file_type} size={THUMB} />}
              {item.file && <CloudBadge file={item.file} className="absolute right-0.5 bottom-0.5 text-neutral-100" />}
              {item.folder && <FolderIcon size={THUMB} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
