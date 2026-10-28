import { useEffect, useRef, useState } from "react";
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
  /** A level's caption under the heading. */
  caption: (levelIndex: number) => string;
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
 * The shared name of these folders, or, when they carry different names, a
 * summary such as "Client (2) · Project (3)".
 */
export function levelName(nodes: FolderTreeNode[], labels: Record<string, string>) {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const name = labels[n.folder_path];
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size > 1) {
    const summary = [...counts].map(([name, count]) => `${name} (${count})`).join(" · ");
    return { value: "", mixed: true, summary };
  }
  return { value: counts.keys().next().value ?? "", mixed: false, summary: "" };
}

/** The level heading's placeholder: what typing a name will apply to. */
export function levelPlaceholder(level: Level, labels: Record<string, string>): string {
  const { targets, partial } = levelTargets(level);
  const { mixed, summary } = levelName(targets, labels);
  if (mixed) return summary;
  if (partial) return `Name ${targets.length} of ${levelNodes(level).length} folders`;
  return "Name this level";
}

/** "3 folders in Houses, Scans", "2 of 3 folders in Houses", or "Saved" right after a commit. */
export function levelCaption<N extends LevelNode>(level: Level<N>, saved: boolean, folderName: (path: string) => string) {
  if (saved) return "Saved";
  const count = levelNodes(level).length;
  const { targets, partial } = levelTargets(level);
  const parents = level.groups.map((g) => folderName(g.parentPath)).join(", ");
  if (partial) return `${targets.length} of ${count} folders in ${parents}`;
  return `${count} folder${count === 1 ? "" : "s"} in ${parents}`;
}

/** Remount key for a level's name input: changes when its folders change, discarding any draft. */
export function levelKey<N extends LevelNode>(level: Level<N>): string {
  return levelNodes(level).map((n) => n.folder_path).join("|");
}

/**
 * Editable level heading. Edits stay local until Enter or blur, so only the
 * final name is ever saved; Escape discards the edit.
 */
export function LevelNameInput({
  value,
  placeholder,
  onCommit,
  className = "",
}: {
  value: string;
  placeholder: string;
  onCommit: (name: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(value);
        } else if (draft.trim() !== value) {
          onCommit(draft);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      spellCheck={false}
      className={`min-w-0 bg-transparent font-semibold placeholder:font-normal placeholder:text-neutral-500 outline-none rounded px-1 -mx-1 focus:bg-neutral-800 focus:text-neutral-100 ${className}`}
    />
  );
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

export interface FolderNoteText {
  text: string;
  title: string;
}

/** A folder's note ("Mapped to Client", a file count), shown beside or under the folder. */
export function FolderNote({ note, className = "" }: { note: FolderNoteText | undefined; className?: string }) {
  if (!note) return null;
  return (
    <span title={note.title} className={`shrink-0 truncate text-[11px] opacity-60 ${className}`}>
      {note.text}
    </span>
  );
}
