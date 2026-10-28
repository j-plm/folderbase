import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { inheritWidths } from "../../lib/columnBrowser";
import { FolderIcon, SymbolIcon } from "../../lib/fileIcons";
import { middleTruncate } from "../../lib/tileLabel";
import { measureText, uiFont } from "../../lib/textMeasure";
import { FolderNote, levelNodes, type FolderNoteText, type LevelLayoutProps, type LevelNode } from "./levels";

// Finder column view metrics, as in ColumnBrowser.
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 140;
const ROW_HEIGHT = 22;
const ICON_SIZE = 16;
const ICON_GAP = 6;
const CHEVRON_SIZE = 10;
const GROUP_GAP = 25;
/** Column inset (8) + row padding (8), each side. */
const ROW_CHROME = 32;
/** Header padding, each side. */
const HEADER_CHROME = 32;
const WIDTH_KEY = "mapping-column-width";

function loadRootWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveRootWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // ignore
  }
}

/** Room a folder's note takes beside its name. */
function noteWidth(note: FolderNoteText | undefined): number {
  return note ? measureText(note.text, uiFont(11)) + ICON_GAP : 0;
}

/** Room left for the name in a row of a column `width` wide. */
function nameWidth(width: number): number {
  return width - ROW_CHROME - ICON_SIZE - ICON_GAP - CHEVRON_SIZE - ICON_GAP;
}

/**
 * Levels as columns: one column per level, headed by the level's property.
 * Selecting several folders groups their children by parent in the next column.
 */
export default function LevelColumns<N extends LevelNode>({
  levels,
  heading,
  headingText,
  caption,
  folderName,
  onToggle,
  onFolderMenu,
  note,
  dimmed,
  hasChildren,
  emptyGroup,
}: LevelLayoutProps<N>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const font = useMemo(() => uiFont(13), []);
  const headerFont = useMemo(() => uiFont(13, 600), []);
  const [widths, setWidths] = useState<number[]>(() => [loadRootWidth()]);
  // New columns inherit the width of the column to their left (Finder behaviour).
  const colWidths = inheritWidths(widths, widths.length - 1, levels.length, DEFAULT_WIDTH);
  // The deepest level with a selection gets the accent highlight, as in Finder.
  const activeLevel = levels.map((l) => l.selected.length > 0).lastIndexOf(true);

  useEffect(() => {
    containerRef.current?.scrollTo({ left: containerRef.current.scrollWidth, behavior: "smooth" });
  }, [levels.length]);

  function startResize(levelIndex: number, e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[levelIndex];
    let latest = startWidth;
    function onMove(ev: MouseEvent) {
      latest = Math.max(MIN_WIDTH, Math.round(startWidth + ev.clientX - startX));
      const next = [...colWidths];
      next[levelIndex] = latest;
      setWidths(next);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      if (levelIndex === 0) saveRootWidth(latest);
    }
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Double-clicking a column edge fits it to its longest folder name or heading. */
  function fitColumn(levelIndex: number) {
    const level = levels[levelIndex];
    const rows = levelNodes(level).map(
      (n) => measureText(n.folder_name, font) + DEFAULT_WIDTH - nameWidth(DEFAULT_WIDTH)
    );
    const headings = [
      headingText(levelIndex),
      ...(level.groups.length > 1 ? level.groups.map((g) => folderName(g.parentPath)) : []),
    ].map((t) => measureText(t, headerFont) + HEADER_CHROME);
    const width = Math.max(MIN_WIDTH, Math.ceil(Math.max(0, ...rows, ...headings)) + 2);
    const next = [...colWidths];
    next[levelIndex] = width;
    setWidths(next);
    if (levelIndex === 0) saveRootWidth(width);
  }

  return (
    <div ref={containerRef} className="flex-1 flex min-h-0 h-full overflow-x-auto overflow-y-hidden">
      {levels.map((level, levelIndex) => {
        const width = colWidths[levelIndex];
        return (
          <div
            key={levelIndex}
            style={{ width }}
            className="relative shrink-0 h-full flex flex-col border-r border-neutral-700/60"
          >
            <div className="shrink-0 flex flex-col px-4 pt-2 pb-1.5 border-b border-neutral-700/60">
              <div className="flex items-center gap-1">{heading(levelIndex, "columns")}</div>
              <span className="text-[11px] text-neutral-500 truncate">{caption(levelIndex)}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {level.groups.map((group, groupIndex) => (
                <Fragment key={group.parentPath}>
                  {level.groups.length > 1 && (
                    <div
                      style={{ marginTop: groupIndex > 0 ? GROUP_GAP : 0 }}
                      className="sticky top-0 z-10 -mx-2 flex items-end h-7 px-4 pb-1.5 bg-neutral-900 text-xs font-semibold text-neutral-500"
                    >
                      {folderName(group.parentPath)}
                    </div>
                  )}
                  {group.nodes.length === 0 && emptyGroup && (
                    <div className="px-2 py-1 text-[12px] text-neutral-500">{emptyGroup(group)}</div>
                  )}
                  {group.nodes.map((node) => {
                    const isSelected = level.selected.includes(node.folder_path);
                    const isDimmed = dimmed(node);
                    const folderNote = note(node);
                    return (
                      <div
                        key={node.folder_path}
                        onClick={(e) => onToggle(levelIndex, node.folder_path, e.shiftKey)}
                        onContextMenu={(e) => onFolderMenu(e, levelIndex, node)}
                        style={{ height: ROW_HEIGHT, gap: ICON_GAP }}
                        className={`flex items-center px-2 rounded-md text-body text-neutral-100 cursor-default select-none ${
                          isSelected ? (levelIndex === activeLevel ? "native-selected" : "bg-neutral-700") : ""
                        } ${isDimmed ? "opacity-50" : ""}`}
                      >
                        <FolderIcon size={ICON_SIZE} />
                        <span className="flex-1 min-w-0 whitespace-nowrap overflow-hidden" title={node.folder_name}>
                          {middleTruncate(node.folder_name, nameWidth(width) - noteWidth(folderNote), (t) => measureText(t, font))}
                        </span>
                        <FolderNote note={folderNote} className="max-w-[45%]" />
                        {hasChildren(node) && (
                          <SymbolIcon
                            name="chevron.right"
                            size={CHEVRON_SIZE}
                            className="text-neutral-400"
                            fallback={<span className="text-neutral-400 text-xs leading-none">›</span>}
                          />
                        )}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
            {/* Drag the column edge to resize; double-click to fit */}
            <div
              onMouseDown={(e) => startResize(levelIndex, e)}
              onDoubleClick={() => fitColumn(levelIndex)}
              className="absolute top-0 -right-[3px] z-20 h-full w-[6px] cursor-col-resize"
            />
          </div>
        );
      })}
    </div>
  );
}
