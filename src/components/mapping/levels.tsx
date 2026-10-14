import { useEffect, useRef, useState } from "react";
import type { FolderTreeNode } from "../../lib/commands";

/** Children of one selected parent, shown together within a level. */
export interface FolderGroup {
  parentPath: string;
  nodes: FolderTreeNode[];
}

/** One mapped level: the children of every folder selected in the level above. */
export interface Level {
  groups: FolderGroup[];
  selected: string[];
}

/** What a mode renderer needs to draw the levels; all state lives in the editor. */
export interface LevelRendererProps {
  levels: Level[];
  labels: Record<string, string>;
  savedLevel: number | null;
  folderName: (path: string) => string;
  onToggle: (levelIndex: number, folderPath: string) => void;
  onCommit: (levelIndex: number, name: string) => void;
}

export function levelNodes(level: Level): FolderTreeNode[] {
  return level.groups.flatMap((g) => g.nodes);
}

/** The level's shared name, or `mixed` when its folders carry different names. */
export function levelName(nodes: FolderTreeNode[], labels: Record<string, string>) {
  const names = new Set(nodes.map((n) => labels[n.folder_path]).filter(Boolean));
  if (names.size > 1) return { value: "", mixed: true };
  return { value: names.values().next().value ?? "", mixed: false };
}

/** "3 folders in Houses, Scans", or "Saved" right after a commit. */
export function levelCaption(level: Level, saved: boolean, folderName: (path: string) => string) {
  if (saved) return "Saved";
  const count = levelNodes(level).length;
  const parents = level.groups.map((g) => folderName(g.parentPath)).join(", ");
  return `${count} folder${count === 1 ? "" : "s"} in ${parents}`;
}

/** Remount key for a level's name input: changes when its folders change, discarding any draft. */
export function levelKey(level: Level): string {
  return levelNodes(level).map((n) => n.folder_path).join("|");
}

/**
 * Editable level heading. Edits stay local until Enter or blur, so only the
 * final name is ever saved; Escape discards the edit.
 */
export function LevelNameInput({
  value,
  mixed,
  onCommit,
  className = "",
}: {
  value: string;
  mixed: boolean;
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
      placeholder={mixed ? "Multiple names" : "Name this level"}
      spellCheck={false}
      className={`min-w-0 bg-transparent font-semibold placeholder:font-normal placeholder:text-neutral-500 outline-none rounded px-1 -mx-1 focus:bg-neutral-800 focus:text-neutral-100 ${className}`}
    />
  );
}
