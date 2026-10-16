import { useCallback, useMemo, useRef } from "react";
import Thumbnail from "./shared/Thumbnail";
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

  const tileElement = useCallback(
    (id: string) => containerRef.current?.querySelector<HTMLElement>(`[data-file-id="${CSS.escape(id)}"]`) ?? null,
    []
  );

  // Arrow keys move by where tiles sit on screen, so rows follow the window width and groups
  const gridNavigate = useCallback((fromId: string, key: ArrowKey) => {
    const tiles = containerRef.current?.querySelectorAll<HTMLElement>("[data-file-id]") ?? [];
    const boxes = Array.from(tiles, (el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.fileId!, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    return gridNeighbor(boxes, fromId, key);
  }, []);

  const selection = useSelection(shown, {
    gridNavigate,
    onReveal: (index) => tileElement(shown[index]?.file_id ?? "")?.scrollIntoView({ block: "nearest" }),
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
      className="flex-1 overflow-auto outline-none"
      tabIndex={0}
      onKeyDown={selection.onKeyDown}
      onClick={selection.clear}
      onContextMenu={(e) => {
        e.preventDefault();
        showContextMenu(arrangementMenu(arrangementCtx));
      }}
    >
      {groups.map((group, groupIndex) => (
        <section
          key={group.label}
          className={groupIndex > 0 ? "border-t border-neutral-700/60" : ""}
        >
          {group.label && (
            <h2 className="px-5 pt-2.5 text-[15px] font-semibold text-neutral-400">
              {group.label}
            </h2>
          )}
          {/* Fixed-size cells and gaps: the window width only changes how many fit per row */}
          <div
            className="grid justify-start gap-y-3 p-4"
            style={{ gridTemplateColumns: `repeat(auto-fill, ${TILE_WIDTH}px)`, columnGap: COLUMN_GAP }}
          >
            {group.files.map((file) => {
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
                    className={`flex items-center justify-center w-[76px] h-[76px] rounded-md ${
                      isSelected ? "bg-neutral-700/70" : ""
                    }`}
                  >
                    <Thumbnail path={file.file_path} mimeType={file.file_type} size={64} />
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
        </section>
      ))}
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
