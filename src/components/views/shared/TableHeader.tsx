import { useRef, useState } from "react";
import type React from "react";
import { dropIndexAt, type ColumnDef, type SortState } from "../../../lib/columns";
import { SymbolIcon } from "../../../lib/fileIcons";

interface Props {
  columns: ColumnDef[];
  widths: Record<string, number>;
  contentWidth: number;
  sort: SortState | null;
  onSort: (columnId: string) => void;
  onResizeStart: (columnId: string, e: React.MouseEvent) => void;
  onResetColumn: (columnId: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Enables drag-to-reorder; called with the column and its insertion index. */
  onReorder?: (columnId: string, targetIndex: number) => void;
  /** Side padding matching the table body's inset. */
  inset?: number;
}

/** Pointer movement before a press on a header becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;

interface DragState {
  columnId: string;
  offset: number;
  targetIndex: number;
}

/** Sticky Finder-style header row: click to sort, drag a divider to resize, drag a header to move it. */
export default function TableHeader({
  columns,
  widths,
  contentWidth,
  sort,
  onSort,
  onResizeStart,
  onResetColumn,
  onContextMenu,
  onReorder,
  inset = 0,
}: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // A drag ends with a click event on the header; this swallows it so it doesn't sort.
  const suppressClick = useRef(false);

  // Leading columns that can't move (Name) also can't be dropped in front of.
  const minIndex = columns.findIndex((c) => c.reorderable !== false);

  function startDrag(col: ColumnDef, e: React.MouseEvent) {
    if (!onReorder || col.reorderable === false || e.button !== 0) return;
    const startX = e.clientX;
    let state: DragState | null = null;

    function onMove(ev: MouseEvent) {
      const offset = ev.clientX - startX;
      if (!state && Math.abs(offset) < DRAG_THRESHOLD) return;
      const left = rowRef.current?.getBoundingClientRect().left ?? 0;
      const targetIndex = dropIndexAt(
        columns.map((c) => widths[c.id] ?? 0),
        ev.clientX - left,
        minIndex
      );
      state = { columnId: col.id, offset, targetIndex };
      setDrag(state);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      if (state) {
        suppressClick.current = true;
        onReorder!(state.columnId, state.targetIndex);
      }
      setDrag(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // x position of the drop indicator
  let indicatorX: number | null = null;
  if (drag) {
    indicatorX = columns.slice(0, drag.targetIndex).reduce((sum, c) => sum + (widths[c.id] ?? 0), 0);
  }

  return (
    <div
      className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-700/60"
      style={{ width: contentWidth + inset * 2, paddingLeft: inset, paddingRight: inset }}
      onContextMenu={onContextMenu}
    >
      <div ref={rowRef} className="relative flex h-7" style={{ width: contentWidth }}>
        {columns.map((col) => {
          const sorted = sort?.key === col.id ? sort.direction : null;
          const isDragged = drag?.columnId === col.id;
          return (
            <div
              key={col.id}
              style={{
                width: widths[col.id],
                transform: isDragged ? `translateX(${drag!.offset}px)` : undefined,
              }}
              onMouseDown={(e) => startDrag(col, e)}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                if (col.sortable !== false) onSort(col.id);
              }}
              className={`relative shrink-0 flex items-center gap-1 px-3 text-xs whitespace-nowrap ${
                sorted ? "text-neutral-100 font-medium" : "text-neutral-400"
              } ${isDragged ? "z-20 bg-neutral-800 shadow-md opacity-90 rounded-sm" : ""}`}
            >
              <span className="truncate">{col.label}</span>
              {sorted && <SortChevron direction={sorted} />}
              <div
                title="Drag to resize · double-click to fit"
                onMouseDown={(e) => onResizeStart(col.id, e)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onResetColumn(col.id);
                }}
                onClick={(e) => e.stopPropagation()}
                className="absolute -right-[4px] top-0 z-10 flex h-full w-[9px] cursor-col-resize justify-center"
              >
                <div className="my-auto h-3.5 w-px bg-neutral-700" />
              </div>
            </div>
          );
        })}
        {indicatorX != null && (
          <div
            className="pointer-events-none absolute top-0 z-30 h-full w-0.5 -translate-x-1/2 bg-blue-500"
            style={{ left: indicatorX }}
          />
        )}
      </div>
    </div>
  );
}

function SortChevron({ direction }: { direction: "asc" | "desc" }) {
  return (
    <SymbolIcon
      name={direction === "asc" ? "chevron.up" : "chevron.down"}
      size={9}
      className="text-neutral-400"
      fallback={
        <svg
          viewBox="0 0 10 6"
          className={`w-2.5 h-1.5 text-neutral-400 ${direction === "desc" ? "" : "rotate-180"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      }
    />
  );
}
