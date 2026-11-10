import type React from "react";
import type { ReactNode } from "react";
import type { FolderTreeNode } from "../../lib/commands";
import { SymbolIcon } from "../../lib/fileIcons";

/**
 * A folder in a level: a real folder (Map Disk Folders) or a virtual one (a view's
 * hierarchy). `folder_path` identifies it; `folder_name` is what shows.
 */
export interface LevelNode {
  folder_path: string;
  folder_name: string;
}

/** Children of one selected parent, shown together within a level. */
export interface FolderGroup<N extends LevelNode = FolderTreeNode> {
  parentPath: string;
  nodes: N[];
}

/** One level: the children of every folder selected in the level above. */
export interface Level<N extends LevelNode = FolderTreeNode> {
  groups: FolderGroup<N>[];
  selected: string[];
}

/** What LevelTiles and LevelColumns need to draw the levels; all state lives in the editor. */
export interface LevelLayoutProps<N extends LevelNode> {
  levels: Level<N>[];
  /** A level's heading (its name or property control), laid out for tiles or columns. */
  heading: (levelIndex: number, layout: "tiles" | "columns") => ReactNode;
  /** The heading's text, so a column can be fitted to it. */
  headingText: (levelIndex: number) => string;
  /** A level's caption under the heading (it may hold an action). */
  caption: (levelIndex: number) => ReactNode;
  /** A click on the heading's background: selects every folder in the level, or none. */
  onHeadingClick?: (levelIndex: number) => void;
  /** A group's parent, named above its folders when a level holds several groups. */
  folderName: (path: string) => string;
  /** Click on a folder: toggles it, or with Shift selects everything from the last click to it. */
  onToggle: (levelIndex: number, folderPath: string, shiftKey: boolean) => void;
  onFolderMenu: (e: React.MouseEvent, levelIndex: number, node: N) => void;
  /** A note beside or under a folder ("Client", "Excluded", "12"). */
  note: (node: N) => FolderNoteText | undefined;
  /** Shown faded (an excluded folder). */
  dimmed: (node: N) => boolean;
  /** Whether selecting it opens more folders (the chevron in Columns). */
  hasChildren: (node: N) => boolean;
  /** What a group with no folders shows instead. */
  emptyGroup?: (group: FolderGroup<N>) => ReactNode;
}

export function levelNodes<N extends LevelNode>(level: Level<N>): N[] {
  return level.groups.flatMap((g) => g.nodes);
}

/**
 * The level's selection after a click on `folderPath`. Selection is additive, so a
 * plain click toggles one folder; a shift-click adds every folder between `anchor`
 * (the last one clicked) and this one. Without an anchor in this level, it's a plain click.
 */
export function clickSelection<N extends LevelNode>(
  level: Level<N>,
  folderPath: string,
  anchor: string | null,
  shiftKey: boolean
): string[] {
  const order = levelNodes(level).map((n) => n.folder_path);
  const from = anchor ? order.indexOf(anchor) : -1;
  const to = order.indexOf(folderPath);
  if (shiftKey && from !== -1 && to !== -1) {
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    return [...level.selected, ...range.filter((p) => !level.selected.includes(p))];
  }
  return level.selected.includes(folderPath)
    ? level.selected.filter((p) => p !== folderPath)
    : [...level.selected, folderPath];
}

/**
 * The folders naming a level applies to: the selected ones when some (but not
 * all) are selected, otherwise every folder in the level.
 */
export function levelTargets<N extends LevelNode>(level: Level<N>): { targets: N[]; partial: boolean } {
  const nodes = levelNodes(level);
  const selected = nodes.filter((n) => level.selected.includes(n.folder_path));
  const partial = selected.length > 0 && selected.length < nodes.length;
  return { targets: partial ? selected : nodes, partial };
}

/**
 * The levels below `fromIndex` after its selection changed: each shows the
 * children of the folders selected above it (in folder order), keeping the
 * selection of folders still shown. So widening a selection opens the new
 * subtrees beside the ones already open, rather than closing them.
 * `childrenOf` gives a folder's children (none for an excluded folder).
 */
export function rebuildLevels<N extends LevelNode>(
  levels: Level<N>[],
  fromIndex: number,
  childrenOf: (path: string) => N[]
): Level<N>[] {
  const out = levels.slice(0, fromIndex + 1);
  for (let i = fromIndex; i < out.length; i++) {
    const level = out[i];
    const selected = new Set(level.selected);
    const groups: FolderGroup<N>[] = levelNodes(level)
      .filter((n) => selected.has(n.folder_path))
      .map((n) => ({ parentPath: n.folder_path, nodes: childrenOf(n.folder_path) }))
      .filter((g) => g.nodes.length > 0);
    if (groups.length === 0) break;
    const shown = new Set(groups.flatMap((g) => g.nodes.map((n) => n.folder_path)));
    const kept = (levels[i + 1]?.selected ?? []).filter((p) => shown.has(p));
    out.push({ groups, selected: kept });
  }
  return out;
}

/** ⌘A or a click on the heading: every folder in the level, or none when all already are (heading only). */
export function selectAllInLevel<N extends LevelNode>(level: Level<N>, toggle = false): string[] {
  const all = levelNodes(level).map((n) => n.folder_path);
  return toggle && all.length > 0 && all.every((p) => level.selected.includes(p)) ? [] : all;
}

/**
 * How these folders are named: the one name they share (`null` when none or
 * several), how many carry a name, and for several names a summary such as
 * "Client (2) · Project (3)".
 */
export function levelCoverage(nodes: LevelNode[], labels: Record<string, string>) {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const name = labels[n.folder_path];
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const named = [...counts.values()].reduce((a, b) => a + b, 0);
  const mixed = counts.size > 1;
  return {
    name: counts.size === 1 ? (counts.keys().next().value as string) : null,
    named,
    total: nodes.length,
    mixed,
    summary: mixed ? [...counts].map(([name, count]) => `${name} (${count})`).join(" · ") : "",
    counts,
  };
}

/**
 * The folders a level's name can be extended to: when its named folders all
 * share one name, the unnamed ones among the targets (the selected folders when
 * only some are selected, else all). `null` when there are none to extend to.
 */
export function levelExtension<N extends LevelNode>(
  level: Level<N>,
  labels: Record<string, string>,
  isExcluded: (path: string) => boolean = () => false
): { name: string; paths: string[]; partial: boolean } | null {
  const { name } = levelCoverage(levelNodes(level), labels);
  if (!name) return null;
  const { targets, partial } = levelTargets(level);
  const paths = targets.filter((n) => !labels[n.folder_path] && !isExcluded(n.folder_path)).map((n) => n.folder_path);
  return paths.length > 0 ? { name, paths, partial } : null;
}

/** "3 folders in Houses, Scans", "2 of 3 folders in Houses", "Series · 5 of 8", or "Saved" right after a commit. */
export function levelCaption<N extends LevelNode>(
  level: Level<N>,
  saved: boolean,
  folderName: (path: string) => string,
  labels: Record<string, string> = {}
) {
  if (saved) return "Saved";
  const count = levelNodes(level).length;
  const { name, named } = levelCoverage(levelNodes(level), labels);
  if (name && named < count) return `${name} · ${named} of ${count}`;
  const { targets, partial } = levelTargets(level);
  const parents = level.groups.map((g) => folderName(g.parentPath)).join(", ");
  if (partial) return `${targets.length} of ${count} folders in ${parents}`;
  return `${count} folder${count === 1 ? "" : "s"} in ${parents}`;
}

/** Names the level's target folders after their parent folders ("Projects" for the folders in Projects). */
export function InheritNameButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="Name After Parent Folder"
      aria-label="Name After Parent Folder"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="shrink-0 w-5 h-5 flex items-center justify-center rounded-[5px] text-neutral-500 hover:text-neutral-100 hover:bg-neutral-700/60"
    >
      <SymbolIcon name="arrow.turn.left.up" size={11} fallback="↰" />
    </button>
  );
}

/** A click on a level heading's background (not its controls or property strip) selects the level. */
export function headingClick(e: React.MouseEvent, levelIndex: number, onHeadingClick?: (levelIndex: number) => void) {
  if (!onHeadingClick || (e.target as Element).closest("button, input, select, [data-no-heading-click]")) return;
  onHeadingClick(levelIndex);
}

export interface FolderNoteText {
  text: string;
  title: string;
  /** What the folder would take, not what it has (an unnamed folder in a named level). */
  faded?: boolean;
}

/** A folder's note ("Mapped to Client", a file count), shown beside or under the folder. */
export function FolderNote({ note, className = "" }: { note: FolderNoteText | undefined; className?: string }) {
  if (!note) return null;
  return (
    <span title={note.title} className={`shrink-0 truncate text-[11px] ${note.faded ? "opacity-25 italic" : "opacity-60"} ${className}`}>
      {note.text}
    </span>
  );
}
