import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Thumbnail from "./shared/Thumbnail";
import CloudBadge from "./shared/CloudBadge";
import { useSelection } from "../../hooks/useSelection";
import { gridNeighbor, type ArrowKey } from "../../lib/selection";
import type { FileRecord } from "../../types";
import { fileName, groupFiles } from "../../lib/arrange";
import { showContextMenu } from "../../lib/nativeMenu";
import { arrangementMenu, useArrangement } from "../../contexts/ArrangementContext";
import { twoLineLabel } from "../../lib/tileLabel";
import { measureText, uiFont } from "../../lib/textMeasure";

interface Props {
  files: FileRecord[];
}

// Finder icon view (macOS 26): 64pt icons, 106pt cells, 9pt column gap.
const TILE_WIDTH = 106;
const COLUMN_GAP = 9;
/** Label text width: cell minus the selection pill's side padding. */
const LABEL_WIDTH = TILE_WIDTH - 8;
/** A tile: 76pt icon backing, 4pt gap, up to two 15pt label lines. */
const TILE_HEIGHT = 110;
const ROW_GAP = 12;
/** Padding around each group's tiles. */
const GROUP_PADDING = 16;

/** A line of the view: a group heading, or a row of tiles. */
type TileItem =
  | { kind: "heading"; label: string; divider: boolean }
  | { kind: "row"; files: FileRecord[]; first: boolean; last: boolean };

/** How many tiles fit across `width`, as the grid's auto-fill would place them. */
function tilesPerRow(width: number): number {
  return Math.max(1, Math.floor((width - GROUP_PADDING * 2 + COLUMN_GAP) / (TILE_WIDTH + COLUMN_GAP)));
}

export default function TilesView({ files }: Props) {
  const arrangementCtx = useArrangement();
  const labelFont = useMemo(() => uiFont(12), []);
  const groups = useMemo(
    () => groupFiles(files, arrangementCtx.arrangement),
    [files, arrangementCtx.arrangement]
  );
  const shown = useMemo(() => groups.flatMap((g) => g.files), [groups]);
  // Laid out once per file list, not on every selection click
  const labels = useMemo(() => {
    const measure = (t: string) => measureText(t, labelFont);
    return new Map(shown.map((f) => [f.file_id, twoLineLabel(fileName(f.file_path), LABEL_WIDTH, measure)]));
  }, [shown, labelFont]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // The grid mounts only once there are files, so watch it again when that changes
  const empty = files.length === 0;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [empty]);
  const perRow = tilesPerRow(width);

  // Rows of tiles per group, so only the rows on screen are rendered
  const items = useMemo(
    () =>
      groups.flatMap((group, groupIndex): TileItem[] => {
        const rows: TileItem[] = [];
        for (let i = 0; i < group.files.length; i += perRow) {
          rows.push({
            kind: "row",
            files: group.files.slice(i, i + perRow),
            first: i === 0,
            last: i + perRow >= group.files.length,
          });
        }
        return group.label ? [{ kind: "heading", label: group.label, divider: groupIndex > 0 }, ...rows] : rows;
      }),
    [groups, perRow]
  );
  const rowOf = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item, i) => item.kind === "row" && item.files.forEach((f) => map.set(f.file_id, i)));
    return map;
  }, [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (i) => {
      const item = items[i];
      if (item.kind === "heading") return 34;
      return TILE_HEIGHT + (item.first ? GROUP_PADDING : 0) + (item.last ? GROUP_PADDING : ROW_GAP);
    },
    overscan: 4,
  });

  // Arrow keys move by where tiles sit in the grid (rows follow the window width and groups)
  const boxes = useMemo(
    () =>
      items.flatMap((item, row) =>
        item.kind === "row" ? item.files.map((f, col) => ({ id: f.file_id, x: col * 100, y: row * 100 })) : []
      ),
    [items]
  );
  const gridNavigate = useCallback((fromId: string, key: ArrowKey) => gridNeighbor(boxes, fromId, key), [boxes]);

  const selection = useSelection(shown, {
    gridNavigate,
    onReveal: (index) => {
      const row = rowOf.get(shown[index]?.file_id ?? "");
      if (row != null) virtualizer.scrollToIndex(row);
    },
  });

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
        No files
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto isolate outline-none"
      tabIndex={0}
      onKeyDown={selection.onKeyDown}
      onClick={selection.clear}
      onContextMenu={(e) => {
        e.preventDefault();
        showContextMenu(arrangementMenu(arrangementCtx));
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((v) => {
          const item = items[v.index];
          const place: React.CSSProperties = {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${v.start}px)`,
          };
          if (item.kind === "heading") {
            return (
              <div
                key={v.key}
                ref={virtualizer.measureElement}
                data-index={v.index}
                style={place}
                className={item.divider ? "border-t border-neutral-700/60" : ""}
              >
                <h2 className="px-5 pt-2.5 text-[15px] font-semibold text-neutral-400">{item.label}</h2>
              </div>
            );
          }
          return (
            // Fixed-size cells and gaps: the window width only changes how many fit per row
            <div
              key={v.key}
              style={{
                ...place,
                height: v.size,
                display: "grid",
                gridTemplateColumns: `repeat(${perRow}, ${TILE_WIDTH}px)`,
                columnGap: COLUMN_GAP,
                alignItems: "start",
                paddingLeft: GROUP_PADDING,
                paddingTop: item.first ? GROUP_PADDING : 0,
              }}
            >
              {item.files.map((file) => {
                const name = fileName(file.file_path);
                const isSelected = selection.isSelected(file.file_id);
                return (
                  <div
                    key={file.file_id}
                    data-file-id={file.file_id}
                    onClick={(e) => selection.onItemClick(e, file.file_id)}
                    onDoubleClick={(e) => selection.onItemDoubleClick(e, file.file_id)}
                    className="flex flex-col items-center gap-1 cursor-default select-none"
                    style={{ width: TILE_WIDTH }}
                  >
                    <div
                      className={`relative flex items-center justify-center w-[76px] h-[76px] rounded-md ${
                        isSelected ? "bg-neutral-700/70" : ""
                      }`}
                    >
                      <Thumbnail path={file.file_path} mimeType={file.file_type} size={64} />
                      <CloudBadge show={file.online_only} className="absolute right-0.5 bottom-0.5 text-neutral-100" />
                    </div>
                    <TileLabel
                      lines={labels.get(file.file_id) ?? [name]}
                      selected={isSelected}
                      title={name}
                      measure={(t) => measureText(t, labelFont)}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A tile's name, highlighted line by line when selected as Finder does: each
 * line's highlight hugs its own text, and where a narrower line meets a wider
 * one its joining corners are square so the two read as one shape.
 */
function TileLabel({
  lines,
  selected,
  title,
  measure,
}: {
  lines: string[];
  selected: boolean;
  title: string;
  measure: (text: string) => number;
}) {
  const widths = lines.map(measure);
  return (
    <span className="flex flex-col items-center max-w-full text-xs leading-[15px]" title={title}>
      {lines.map((line, i) => {
        const squareTop = i > 0 && widths[i] <= widths[i - 1];
        const squareBottom = i < lines.length - 1 && widths[i] <= widths[i + 1];
        return (
          <span
            key={i}
            className={`max-w-full px-1 whitespace-nowrap rounded-[4px] ${
              selected ? "bg-blue-600 text-white" : "text-neutral-100"
            } ${squareTop ? "rounded-t-none" : ""} ${squareBottom ? "rounded-b-none" : ""}`}
          >
            {line}
          </span>
        );
      })}
    </span>
  );
}
