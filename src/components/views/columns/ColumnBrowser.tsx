import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useScrollAheadVirtualizer } from "../../../hooks/useScrollAheadVirtualizer";
import { openPaths } from "../../../lib/commands";
import { hasPrimaryModifier, isOpenShortcut, isToggleSelect } from "../../../lib/platform";
import {
  DOUBLE_CLICK_MS,
  EMPTY_SELECTION,
  clickSelect,
  moveSelection,
  openTargets,
  selectAll,
  singleSelection,
  type SelectionState,
} from "../../../lib/selection";
import { FileIcon, FolderIcon, SymbolIcon, isImageMime } from "../../../lib/fileIcons";
import CloudBadge, { CLOUD_BADGE_WIDTH } from "../shared/CloudBadge";
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
  type NodeGroup,
} from "../../../lib/columnBrowser";
import { middleTruncate } from "../../../lib/tileLabel";
import { measureText, uiFont } from "../../../lib/textMeasure";
import { useReportSelection } from "../../../lib/selectionStatus";
import { showContextMenu, withLead, type MenuEntry } from "../../../lib/nativeMenu";
import { arrangementMenu, useArrangedBy, useArrangement, useGroupProperties } from "../../../contexts/ArrangementContext";
import { ARRANGED_GROUPS } from "../../../lib/fileDrag";

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** The folders along a path (ids), up to the first file; with several selected, the last item doesn't open. */
function openFolders(root: BrowserNode[], path: string[], multi: boolean): string[] {
  return resolveColumns(root, multi ? path.slice(0, -1) : path)
    .selected.filter(isFolder)
    .map((n) => n.id);
}

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
const HEADING_HEIGHT = 28;
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
 *
 * Several items can be selected within the active (rightmost) column with
 * Cmd/Ctrl-click, Shift-click, Shift-arrows or Cmd-A; while more than one is
 * selected nothing opens to the right. `path` always ends at the item last
 * clicked or moved to, and `sel` holds the selection in that column.
 */
export default function ColumnBrowser({
  root,
  folderPath,
  onFolderPathChange,
  nodeMenu,
  columnMenu,
  onRowsPress,
  rowDropPath,
  columnDropPath,
}: {
  root: BrowserNode[];
  /** The folders open (their ids), followed when it changes elsewhere (Back, Enclosing Folder). */
  folderPath?: string[];
  /** The folders open changed here. */
  onFolderPathChange?: (ids: string[]) => void;
  /** A row's own right-click menu, given the column's folder and what it acts on (null: the column's arrangement menu). */
  nodeMenu?: (node: BrowserNode, parent: BrowserNode | null, nodes: BrowserNode[]) => MenuEntry[] | null;
  /** A column's empty-space menu, before the arrangement items, by the folder it shows (null: the first column). */
  columnMenu?: (parent: BrowserNode | null) => MenuEntry[];
  /** A press on a row, in the column showing `parent`: `nodes` is what a drag from it carries (the selection there, or the row). */
  onRowsPress?: (e: React.PointerEvent, parent: BrowserNode | null, nodes: () => BrowserNode[]) => void;
  /** Where a row takes what's dropped on it (null: it doesn't). */
  rowDropPath?: (node: BrowserNode) => string[] | null;
  /** Where a column's empty space takes a drop, by the folder it shows (null: the first column). */
  columnDropPath?: (parent: BrowserNode | null) => string[] | null;
}) {
  const arrangementCtx = useArrangement();
  const { arrangement, byProperty, groupsTakeDrops } = useArrangedBy();
  const groupProperties = useGroupProperties();
  const [path, setPath] = useState<string[]>(() => folderPath ?? []);
  const [sel, setSel] = useState<SelectionState>(EMPTY_SELECTION);
  const multi = sel.selected.length > 1;
  const pendingCollapse = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pendingCollapse.current), []);
  const [widths, setWidths] = useState<number[]>(() => [loadRootWidth()]);
  const containerRef = useRef<HTMLDivElement>(null);
  const font = useMemo(() => uiFont(13), []);

  // With several items selected, the last one clicked doesn't open a column
  const { columns, selected } = resolveColumns(root, multi ? path.slice(0, -1) : path);
  const arranged = useMemo(
    () => columns.map((c) => arrangeColumn(c, arrangement, byProperty)),
    // `columns` is derived from root + path, which are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, path, multi, arrangement, byProperty]
  );
  const ordered = arranged.map((groups) => groups.flatMap((g) => g.nodes));
  const colWidths = inheritWidths(widths, widths.length - 1, columns.length, DEFAULT_WIDTH);
  const activeDepth = Math.max(path.length - 1, 0);
  const previewNode = !multi && selected.length > 0 && !isFolder(selected[selected.length - 1])
    ? selected[selected.length - 1]
    : null;
  const activeOrder = (ordered[activeDepth] ?? []).map((n) => n.id);
  // Finder counts the selection within the column it's in
  useReportSelection(multi ? sel.selected.length : path.length > 0 ? 1 : 0, activeOrder.length);

  function isSelectedAt(depth: number, id: string | undefined): boolean {
    if (id == null) return false;
    return depth === activeDepth && multi ? sel.selected.includes(id) : path[depth] === id;
  }

  /** `several`: more than one item is selected now, so the last one doesn't open. */
  function update(nextPath: string[], changedDepth: number, several = false) {
    setPath(nextPath);
    const count = resolveColumns(root, nextPath).columns.length;
    setWidths((w) => inheritWidths(w, changedDepth, count, DEFAULT_WIDTH));
    const folders = openFolders(root, nextPath, several);
    if (onFolderPathChange && !sameIds(folders, folderPath ?? [])) onFolderPathChange(folders);
  }

  // Follow the open folders when they change elsewhere
  useEffect(() => {
    if (!folderPath) return;
    if (sameIds(openFolders(root, path, multi), folderPath)) return;
    setPath(folderPath);
    const last = folderPath[folderPath.length - 1];
    setSel(last ? singleSelection(last) : EMPTY_SELECTION);
    // Only a change to the folders open should move the columns, not a new root
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath]);

  /** Single-item navigation: the selection follows the end of the path. */
  function navigateTo(nextPath: string[], changedDepth: number) {
    const last = nextPath[nextPath.length - 1];
    setSel(last ? singleSelection(last) : EMPTY_SELECTION);
    update(nextPath, changedDepth);
  }

  /** Applies a selection in column `depth`, with `cursor` the item last clicked or moved to. */
  function applySelection(depth: number, next: SelectionState, cursor: string) {
    setSel(next);
    if (next.selected.length === 0) update(selectAt(path, depth, null), depth);
    else update(selectAt(path, depth, next.selected.length === 1 ? next.selected[0] : cursor), depth, next.selected.length > 1);
  }

  function handleRowClick(e: React.MouseEvent, depth: number, node: BrowserNode) {
    e.stopPropagation();
    containerRef.current?.focus();
    if (e.detail > 1) return;
    window.clearTimeout(pendingCollapse.current);
    const mods = { toggle: isToggleSelect(e), range: e.shiftKey };
    // Modifiers extend the selection only within the active column
    const base = depth === activeDepth ? sel : EMPTY_SELECTION;
    const order = ordered[depth].map((n) => n.id);
    const next = clickSelect(base, order, node.id, mods);
    // A plain click inside a multiple selection waits, so a double-click opens them all
    if (!mods.toggle && !mods.range && depth === activeDepth && multi && sel.selected.includes(node.id)) {
      pendingCollapse.current = window.setTimeout(() => applySelection(depth, next, node.id), DOUBLE_CLICK_MS);
      return;
    }
    applySelection(depth, next, node.id);
  }

  function handleRowDoubleClick(e: React.MouseEvent, depth: number, node: BrowserNode) {
    window.clearTimeout(pendingCollapse.current);
    if (e.shiftKey || isToggleSelect(e)) return;
    const order = ordered[depth].map((n) => n.id);
    const ids = depth === activeDepth && multi ? openTargets(sel, order, node.id) : [node.id];
    open(ordered[depth].filter((n) => ids.includes(n.id)));
  }

  // Keep the newest column in view (each column keeps its selected row in view itself)
  useEffect(() => {
    containerRef.current?.scrollTo({ left: containerRef.current.scrollWidth, behavior: "smooth" });
  }, [path, columns.length]);

  /** Opens the files among `nodes` together, as Finder opens a multiple selection. */
  function open(nodes: BrowserNode[]) {
    const paths = nodes.flatMap((n) => (n.file ? [n.file.file_path] : []));
    if (paths.length > 0) openPaths(paths).catch(() => {});
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const active = ordered[activeDepth] ?? [];
    if (isOpenShortcut(e)) {
      e.preventDefault();
      open(active.filter((n) => isSelectedAt(activeDepth, n.id)));
      return;
    }
    if (hasPrimaryModifier(e) && e.key === "a") {
      e.preventDefault();
      if (activeOrder.length > 0) applySelection(activeDepth, selectAll(activeOrder), path[activeDepth] ?? activeOrder[0]);
      return;
    }
    if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const current = sel.selected.length > 0 ? sel : path[activeDepth] ? singleSelection(path[activeDepth]) : EMPTY_SELECTION;
      const moved = moveSelection(current, activeOrder, e.key === "ArrowDown" ? 1 : -1, true, path[activeDepth] ?? null);
      if (moved) applySelection(activeDepth, moved.state, moved.cursor);
      return;
    }
    // ⌘↑ goes to the enclosing folder (BrowseContext), not up the column
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const next = navigate(path, ordered, e.key as ArrowKey);
    let changed = 0;
    while (changed < path.length && path[changed] === next[changed]) changed++;
    navigateTo(next, changed);
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
      data-browse-keys
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        showContextMenu(arrangementMenu(arrangementCtx, groupProperties));
      }}
      style={{ paddingLeft: "var(--sidebar-inset)", scrollPaddingLeft: "var(--sidebar-inset)" }}
      className="flex-1 flex min-h-0 overflow-x-auto overflow-y-hidden outline-none"
    >
      {arranged.map((groups, depth) => {
        const parent = depth === 0 ? null : (selected[depth - 1] ?? null);
        const dropPath = columnDropPath?.(parent);
        /** What a drag or right-click on a row acts on: the selection here if the row's in it, else the row. */
        const targetsOf = (node: BrowserNode) =>
          depth === activeDepth && multi && sel.selected.includes(node.id)
            ? ordered[depth].filter((n) => sel.selected.includes(n.id))
            : [node];
        return (
        <div
          key={depth}
          {...(dropPath ? { "data-drop-path": JSON.stringify(dropPath), "data-drop-kind": "area" } : {})}
          style={{ width: colWidths[depth] }}
          onClick={() => navigateTo(selectAt(path, depth, null), depth)}
          // Empty space in a column: what its folders are (their level's settings), then the arrangement
          onContextMenu={(e) => {
            const lead = columnMenu?.(parent) ?? [];
            if (lead.length === 0) return;
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(withLead(lead, arrangementMenu(arrangementCtx, groupProperties)), { event: e });
          }}
          className="relative shrink-0 h-full border-r border-neutral-700/60"
        >
          <ColumnList
            groups={groups}
            groupsTakeDrops={groupsTakeDrops}
            width={colWidths[depth]}
            font={font}
            active={depth === activeDepth}
            isSelected={(id) => isSelectedAt(depth, id)}
            revealId={path[depth]}
            onRowClick={(e, node) => handleRowClick(e, depth, node)}
            onRowDoubleClick={(e, node) => handleRowDoubleClick(e, depth, node)}
            onRowPointerDown={(e, node) => onRowsPress?.(e, parent, () => targetsOf(node))}
            dropPathOf={rowDropPath}
            onRowMenu={(e, node) => {
              const entries = nodeMenu?.(node, parent, targetsOf(node));
              if (!entries) return;
              e.preventDefault();
              e.stopPropagation();
              showContextMenu(entries, { event: e });
            }}
          />
          {/* Drag the column edge to resize; double-click to fit. Outside the
              scrolling list, so it stays put however far the column is scrolled */}
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
      {/* Room to scroll the last column out from behind an open side panel */}
      <div style={{ width: "var(--scroll-end, 0px)" }} className="shrink-0" aria-hidden />
    </div>
  );
}

/** A line of a column: a group heading, or an item with its neighbours (for joined selections). */
type ColumnItem =
  | { kind: "heading"; label: string; value?: string; first: boolean }
  | { kind: "row"; node: BrowserNode; prev?: string; next?: string };

/**
 * One column's list. Only the rows on screen are rendered (and only their
 * names truncated), so a column of thousands scrolls and resizes smoothly.
 */
function ColumnList({
  groups,
  width,
  font,
  active,
  isSelected,
  revealId,
  onRowClick,
  onRowDoubleClick,
  onRowMenu,
  onRowPointerDown,
  dropPathOf,
  groupsTakeDrops = false,
}: {
  groups: NodeGroup[];
  /** Grouped by a property of one value: headings take drops, giving files its value. */
  groupsTakeDrops?: boolean;
  width: number;
  font: string;
  /** The column the selection is in (its selection is accent-coloured). */
  active: boolean;
  isSelected: (id: string | undefined) => boolean;
  /** The column's selected item, kept in view. */
  revealId: string | undefined;
  onRowClick: (e: React.MouseEvent, node: BrowserNode) => void;
  onRowDoubleClick: (e: React.MouseEvent, node: BrowserNode) => void;
  onRowMenu: (e: React.MouseEvent, node: BrowserNode) => void;
  onRowPointerDown: (e: React.PointerEvent, node: BrowserNode) => void;
  /** Where a row takes a drop (null: it doesn't). */
  dropPathOf?: (node: BrowserNode) => string[] | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () =>
      groups.flatMap((g, gi): ColumnItem[] => [
        ...(g.label ? [{ kind: "heading" as const, label: g.label, value: g.value, first: gi === 0 }] : []),
        ...g.nodes.map((node, i) => ({
          kind: "row" as const,
          node,
          prev: g.nodes[i - 1]?.id,
          next: g.nodes[i + 1]?.id,
        })),
      ]),
    [groups]
  );
  const sizeOf = (item: ColumnItem) => (item.kind === "heading" ? HEADING_HEIGHT + (item.first ? 0 : GROUP_GAP) : ROW_HEIGHT);
  const virtualizer = useScrollAheadVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => sizeOf(items[i]),
    overscan: 20,
  });

  // Where each group heading reaches the top of the column (sizes are fixed, so exact)
  const headings = useMemo(() => {
    const found: { label: string; value?: string; top: number }[] = [];
    let offset = 0;
    for (const item of items) {
      if (item.kind === "heading") found.push({ label: item.label, value: item.value, top: offset + (item.first ? 0 : GROUP_GAP) });
      offset += sizeOf(item);
    }
    return found;
  }, [items]);
  // The group scrolled into, whose heading stays pinned at the top as Finder's does;
  // the next group's heading covers it as it arrives
  const scrollTop = virtualizer.scrollOffset ?? 0;
  const pinned = headings.filter((h) => h.top <= scrollTop).pop() ?? headings[0];
  /** A heading as a drop target, when the grouping takes drops. */
  const dropOn = (value: string | undefined) =>
    groupsTakeDrops && value != null ? { "data-drop-path": JSON.stringify([value]), "data-drop-source": ARRANGED_GROUPS } : {};

  useEffect(() => {
    if (!revealId) return;
    const i = items.findIndex((item) => item.kind === "row" && item.node.id === revealId);
    if (i >= 0) virtualizer.scrollToIndex(i, { align: "auto" });
  }, [revealId, items, virtualizer]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      {pinned && (
        <div
          {...dropOn(pinned.value)}
          style={{ height: HEADING_HEIGHT, marginBottom: -HEADING_HEIGHT }}
          className="sticky top-0 z-10 flex items-end px-4 pb-1.5 bg-neutral-900 text-xs font-semibold text-neutral-500"
        >
          {pinned.label}
        </div>
      )}
      <div className="px-2 pb-2">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => {
            const item = items[v.index];
            const place: React.CSSProperties = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: v.size,
              transform: `translateY(${v.start}px)`,
            };
            if (item.kind === "heading") {
              return (
                <div
                  key={v.key}
                  {...dropOn(item.value)}
                  // Full column width, past the list's side padding
                  style={{ ...place, left: -8, width: "calc(100% + 16px)" }}
                  // Above the pinned heading, so an arriving group's heading slides over it
                  className="z-20 flex items-end px-4 pb-1.5 bg-neutral-900 text-xs font-semibold text-neutral-500"
                >
                  {item.label}
                </div>
              );
            }
            const { node } = item;
            const folder = isFolder(node);
            const selected = isSelected(node.id);
            const emphasised = selected && active;
            // Adjacent selected rows join into one block, as in Finder
            const joinsAbove = selected && isSelected(item.prev);
            const joinsBelow = selected && isSelected(item.next);
            return (
              <div
                key={v.key}
                data-node={node.id}
                data-drop-path={(() => {
                  const path = dropPathOf?.(node);
                  return path ? JSON.stringify(path) : undefined;
                })()}
                onPointerDown={(e) => onRowPointerDown(e, node)}
                onClick={(e) => onRowClick(e, node)}
                onDoubleClick={(e) => onRowDoubleClick(e, node)}
                onContextMenu={(e) => onRowMenu(e, node)}
                style={{ ...place, gap: ICON_GAP }}
                className={`flex items-center px-2 rounded-md text-body text-neutral-100 cursor-default ${
                  joinsAbove ? "rounded-t-none" : ""
                } ${joinsBelow ? "rounded-b-none" : ""} ${
                  emphasised ? "native-selected" : selected ? "bg-neutral-700" : ""
                }`}
              >
                {folder ? (
                  <FolderIcon size={ICON_SIZE} />
                ) : (
                  <FileIcon path={node.file!.file_path} mimeType={node.file!.file_type} size={ICON_SIZE} />
                )}
                <span className="flex-1 min-w-0 whitespace-nowrap overflow-hidden" title={node.name}>
                  {middleTruncate(
                    node.name,
                    nameWidth(width, folder) - (node.file?.online_only ? CLOUD_BADGE_WIDTH : 0),
                    (t) => measureText(t, font)
                  )}
                </span>
                <CloudBadge show={node.file?.online_only} />
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
        </div>
      </div>
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
          // An online-only image would download to show in full; its icon stands in
          (isImageMime(file.file_type) && !file.online_only ? (
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
