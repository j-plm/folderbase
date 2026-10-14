import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "../../../lib/commands";
import { FileIcon, FolderIcon, SymbolIcon, isImageMime } from "../../../lib/fileIcons";
import { formatFinderSize, formatLongDate, kindLabel } from "../../../lib/arrange";
import {
  arrangeColumn,
  inheritWidths,
  isFolder,
  navigate,
  resolveColumns,
  selectAt,
  type ArrowKey,
  type BrowserNode,
} from "../../../lib/columnBrowser";
import { middleTruncate } from "../../../lib/tileLabel";
import { measureText, uiFont } from "../../../lib/textMeasure";
import { showContextMenu } from "../../../lib/nativeMenu";
import { arrangementMenu, useArrangement } from "../../../contexts/ArrangementContext";

// Finder column view metrics (macOS 26)
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 140;
const PREVIEW_MIN_WIDTH = 280;
const ROW_HEIGHT = 22;
const ICON_SIZE = 16;
const ICON_GAP = 6;
const CHEVRON_SIZE = 10;
/** Space above each group heading after the first (measured from Finder). */
const GROUP_GAP = 25;
/** Column inset (8) + row padding (8), each side. */
const ROW_CHROME = 32;
const WIDTH_KEY = "column-view-width";

function loadRootWidth(): number {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  return saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH;
}

/** Room left for the name in a row of a column `width` wide. */
function nameWidth(width: number, folder: boolean): number {
  return width - ROW_CHROME - ICON_SIZE - ICON_GAP - (folder ? CHEVRON_SIZE + ICON_GAP : 0);
}

/**
 * Finder column view: each column lists one level; selecting a folder opens
 * its contents in a new column, selecting a file shows a preview column.
 */
export default function ColumnBrowser({ root }: { root: BrowserNode[] }) {
  const arrangementCtx = useArrangement();
  const { arrangement } = arrangementCtx;
  const [path, setPath] = useState<string[]>([]);
  const [widths, setWidths] = useState<number[]>(() => [loadRootWidth()]);
  const containerRef = useRef<HTMLDivElement>(null);
  const font = useMemo(() => uiFont(13), []);

  const { columns, selected } = resolveColumns(root, path);
  const arranged = useMemo(
    () => columns.map((c) => arrangeColumn(c, arrangement)),
    // `columns` is derived from root + path, which are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, path, arrangement]
  );
  const ordered = arranged.map((groups) => groups.flatMap((g) => g.nodes));
  const colWidths = inheritWidths(widths, widths.length - 1, columns.length, DEFAULT_WIDTH);
  const activeDepth = Math.max(selected.length - 1, 0);
  const previewNode = selected.length > 0 && !isFolder(selected[selected.length - 1])
    ? selected[selected.length - 1]
    : null;

  function update(nextPath: string[], changedDepth: number) {
    setPath(nextPath);
    const count = resolveColumns(root, nextPath).columns.length;
    setWidths((w) => inheritWidths(w, changedDepth, count, DEFAULT_WIDTH));
  }

  // Keep the newest column and the selected row in view.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    const last = path[path.length - 1];
    if (last) {
      el.querySelector(`[data-node="${CSS.escape(last)}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }, [path, columns.length]);

  async function open(node: BrowserNode) {
    if (!node.file) return;
    try {
      await openPath(node.file.file_path);
    } catch {
      // ignore
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.metaKey && e.key === "ArrowDown") {
      e.preventDefault();
      if (previewNode) open(previewNode);
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const next = navigate(path, ordered, e.key as ArrowKey);
    let changed = 0;
    while (changed < path.length && path[changed] === next[changed]) changed++;
    update(next, changed);
  }

  function startResize(depth: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[depth];
    let latest = startWidth;
    function onMove(ev: MouseEvent) {
      latest = Math.max(MIN_WIDTH, Math.round(startWidth + ev.clientX - startX));
      setWidths(() => {
        const next = [...colWidths];
        next[depth] = latest;
        return next;
      });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      if (depth === 0) localStorage.setItem(WIDTH_KEY, String(latest));
    }
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Double-clicking a column edge fits the column to its longest name. */
  function fitColumn(depth: number) {
    const widest = Math.max(
      0,
      ...columns[depth].map(
        (n) => measureText(n.name, font) + DEFAULT_WIDTH - nameWidth(DEFAULT_WIDTH, isFolder(n))
      )
    );
    const width = Math.max(MIN_WIDTH, Math.ceil(widest) + 2);
    const next = [...colWidths];
    next[depth] = width;
    setWidths(next);
    if (depth === 0) localStorage.setItem(WIDTH_KEY, String(width));
  }

  if (root.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
        No files
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        showContextMenu(arrangementMenu(arrangementCtx));
      }}
      style={{ paddingLeft: "var(--sidebar-inset)", scrollPaddingLeft: "var(--sidebar-inset)" }}
      className="flex-1 flex min-h-0 overflow-x-auto overflow-y-hidden outline-none"
    >
      {arranged.map((groups, depth) => {
        const width = colWidths[depth];
        return (
          <div
            key={depth}
            style={{ width }}
            onClick={() => update(selectAt(path, depth, null), depth)}
            className="relative shrink-0 h-full overflow-y-auto border-r border-neutral-700/60"
          >
            <div className="px-2 pb-2">
              {groups.map((group, groupIndex) => (
                <Fragment key={group.label}>
                  {group.label && (
                    <div
                      style={{ marginTop: groupIndex > 0 ? GROUP_GAP : 0 }}
                      className="sticky top-0 z-10 -mx-2 flex items-end h-7 px-4 pb-1.5 bg-neutral-900 text-xs font-semibold text-neutral-500"
                    >
                      {group.label}
                    </div>
                  )}
                  {group.nodes.map((node) => {
                    const folder = isFolder(node);
                    const isSelected = path[depth] === node.id;
                    const emphasised = isSelected && depth === activeDepth;
                    return (
                      <div
                        key={node.id}
                        data-node={node.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          containerRef.current?.focus();
                          update(selectAt(path, depth, node.id), depth);
                        }}
                        onDoubleClick={() => open(node)}
                        style={{ height: ROW_HEIGHT, gap: ICON_GAP }}
                        className={`flex items-center px-2 rounded-md text-body text-neutral-100 cursor-default ${
                          emphasised ? "native-selected" : isSelected ? "bg-neutral-700" : ""
                        }`}
                      >
                        {folder ? (
                          <FolderIcon size={ICON_SIZE} />
                        ) : (
                          <FileIcon path={node.file!.file_path} mimeType={node.file!.file_type} size={ICON_SIZE} />
                        )}
                        <span className="flex-1 min-w-0 whitespace-nowrap overflow-hidden" title={node.name}>
                          {middleTruncate(node.name, nameWidth(width, folder), (t) => measureText(t, font))}
                        </span>
                        {folder && (
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
              onMouseDown={(e) => startResize(depth, e)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                fitColumn(depth);
              }}
              onClick={(e) => e.stopPropagation()}
              className="absolute top-0 -right-[3px] z-20 h-full w-[6px] cursor-col-resize"
            />
          </div>
        );
      })}

      {previewNode?.file && <PreviewColumn node={previewNode} />}
    </div>
  );
}

/** Largest preview icon / thumbnail edge, in points. */
const PREVIEW_MAX = 512;

/**
 * Finder's preview column: fills the remaining width; the icon or image scales
 * to the space, with name, kind – size, Information and Tags below.
 */
function PreviewColumn({ node }: { node: BrowserNode }) {
  const file = node.file!;
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setStage({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Native icons are rendered at fixed sizes; step in 32pt increments so
  // resizing doesn't request a new icon for every pixel.
  const fit = Math.min(stage.width, stage.height, PREVIEW_MAX);
  const iconSize = Math.max(64, Math.floor(fit / 32) * 32);
  const info: [string, string][] = [
    ["Created", formatLongDate(file.timestamp)],
    ["Modified", formatLongDate(file.modified_at ?? file.timestamp)],
  ];
  const tags = Array.isArray(file.tags) ? file.tags : [];

  return (
    <div
      style={{ minWidth: PREVIEW_MIN_WIDTH }}
      className="flex-1 h-full flex flex-col overflow-y-auto px-10 pt-6 pb-8"
    >
      <div ref={stageRef} className="flex-1 min-h-[160px] flex items-center justify-center">
        {stage.width > 0 &&
          (isImageMime(file.file_type) ? (
            <img
              src={convertFileSrc(file.file_path)}
              alt=""
              draggable={false}
              style={{ maxWidth: fit, maxHeight: fit }}
              className="object-contain shadow-sm"
            />
          ) : (
            <FileIcon path={file.file_path} mimeType={file.file_type} size={iconSize} />
          ))}
      </div>
      <div className="shrink-0 mt-6">
        <p className="text-[15px] font-semibold text-neutral-100 break-words">{node.name}</p>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          {kindLabel(file)} - {formatFinderSize(file.file_size)}
        </p>
        <p className="mt-4 mb-1 text-[15px] font-semibold text-neutral-100">Information</p>
        <dl className="text-xs">
          {info.map(([label, value], i) => (
            <div
              key={label}
              className={`flex justify-between gap-3 py-1.5 ${i > 0 ? "border-t border-neutral-700/60" : ""}`}
            >
              <dt className="text-neutral-500">{label}</dt>
              <dd className="font-semibold text-neutral-100 text-right">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 mb-1 text-[15px] font-semibold text-neutral-100">Tags</p>
        {tags.length > 0 ? (
          <p className="text-[13px] text-neutral-100">{tags.join(", ")}</p>
        ) : (
          <p className="text-[13px] text-neutral-500">No Tags</p>
        )}
      </div>
    </div>
  );
}
