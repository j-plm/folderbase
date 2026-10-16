import { useEffect, useRef, useState } from "react";
import type React from "react";
import {
  clearFolderLabels,
  countMappingConflicts,
  excludeFolder,
  includeFolder,
  ingestDirectory,
  setFolderLabels,
} from "../../lib/commands";
import type { FolderTreeNode, PathMappingNode } from "../../lib/commands";
import { useOverwriteConfirm } from "../shared/OverwriteDialog";
import Dialog, { DialogButton } from "../shared/Dialog";
import { showContextMenu } from "../../lib/nativeMenu";
import { clickSelection, levelTargets, type FolderGroup, type Level, type LevelRendererProps } from "./levels";
import MappingColumns from "./MappingColumns";
import MappingTiles from "./MappingTiles";

type Mode = "tiles" | "columns";

const MODE_KEY = "mapping-editor-mode";
const MODES: { mode: Mode; label: string }[] = [
  { mode: "tiles", label: "Tiles" },
  { mode: "columns", label: "Columns" },
];

interface Props {
  locationId: string;
  rootNode: FolderTreeNode;
  initialMappings: PathMappingNode[];
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function findNode(tree: FolderTreeNode, path: string): FolderTreeNode | null {
  if (tree.folder_path === path) return tree;
  for (const child of tree.children) {
    const found = findNode(child, path);
    if (found) return found;
  }
  return null;
}

function excludedPaths(tree: FolderTreeNode, into = new Set<string>()): Set<string> {
  if (tree.excluded) into.add(tree.folder_path);
  for (const child of tree.children) excludedPaths(child, into);
  return into;
}

function buildInitialLevels(rootPath: string, tree: FolderTreeNode): Level[] {
  const root = findNode(tree, rootPath);
  if (!root || root.children.length === 0) return [];
  return [{ groups: [{ parentPath: rootPath, nodes: root.children }], selected: [] }];
}

function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "columns" ? "columns" : "tiles";
  } catch {
    return "tiles";
  }
}

// ── Main component ─────────────────────────────────────────────────────────

/**
 * Maps folder levels to property names. Owns the levels, selection and
 * per-folder names; Tiles and Columns are two renderings of the same state.
 */
export default function FolderBrowserEditor({ locationId, rootNode, initialMappings }: Props) {
  const [mode, setMode] = useState<Mode>(loadMode);
  const [levels, setLevels] = useState<Level[]>(() => buildInitialLevels(rootNode.folder_path, rootNode));
  // Property name per folder path — mappings are stored per folder, never per depth.
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialMappings.map((m) => [m.folder_path, m.property_name]))
  );
  const [savedLevel, setSavedLevel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The last folder clicked, where a shift-click's range starts. */
  const anchor = useRef<{ levelIndex: number; path: string } | null>(null);
  const { confirm, dialog } = useOverwriteConfirm();
  const [excluded, setExcluded] = useState<Set<string>>(() => excludedPaths(rootNode));
  /** A folder waiting for the user to confirm excluding it. */
  const [excluding, setExcluding] = useState<{ node: FolderTreeNode; levelIndex: number } | null>(null);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  function folderName(path: string): string {
    return findNode(rootNode, path)?.folder_name ?? path.split("/").pop() ?? path;
  }

  function changeMode(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // ignore
    }
  }

  function toggleSelection(levelIndex: number, folderPath: string, shiftKey = false) {
    const from = anchor.current?.levelIndex === levelIndex ? anchor.current.path : null;
    anchor.current = { levelIndex, path: folderPath };
    setLevels((prev) => {
      const level = prev[levelIndex];
      const newSelected = clickSelection(level, folderPath, from, shiftKey);

      const base: Level[] = [...prev.slice(0, levelIndex), { ...level, selected: newSelected }];

      const newGroups: FolderGroup[] = newSelected.flatMap((selPath) => {
        // An excluded folder's contents aren't part of the location
        if (excluded.has(selPath)) return [];
        const selNode = findNode(rootNode, selPath);
        return selNode && selNode.children.length > 0
          ? [{ parentPath: selPath, nodes: selNode.children }]
          : [];
      });

      if (newGroups.length === 0) return base;
      return [...base, { groups: newGroups, selected: [] }];
    });
  }

  /** Shows "Saved" under a level's heading for a moment. */
  function flashSaved(levelIndex: number) {
    setSavedLevel(levelIndex);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedLevel(null), 1400);
  }

  /**
   * Maps folders, grouped by the property each takes. Asks first when a Select
   * property would lose values files already hold; Cancel maps nothing.
   */
  async function applyNames(byName: Map<string, string[]>): Promise<boolean> {
    let overwrite = false;
    for (const [name, paths] of byName) {
      const conflicts = await countMappingConflicts(locationId, paths, name);
      if (conflicts > 0) {
        if (!(await confirm(name, conflicts))) return false;
        overwrite = true;
      }
    }
    for (const [name, paths] of byName) {
      await setFolderLabels(locationId, paths, name, overwrite);
    }
    setLabels((prev) => {
      const next = { ...prev };
      for (const [name, paths] of byName) for (const p of paths) next[p] = name;
      return next;
    });
    return true;
  }

  /**
   * Names the level's target folders (see `levelTargets`: the selected ones when
   * only some are selected, otherwise all of them). A blank name clears them.
   */
  async function commitLevelName(levelIndex: number, name: string) {
    const trimmed = name.trim();
    const { targets } = levelTargets(levels[levelIndex]);
    setError(null);
    try {
      if (trimmed) {
        const paths = targets.filter((n) => labels[n.folder_path] !== trimmed).map((n) => n.folder_path);
        if (paths.length === 0 || !(await applyNames(new Map([[trimmed, paths]])))) return;
      } else {
        const paths = targets.filter((n) => labels[n.folder_path]).map((n) => n.folder_path);
        if (paths.length === 0) return;
        await clearFolderLabels(locationId, paths);
        setLabels((prev) => {
          const next = { ...prev };
          for (const p of paths) delete next[p];
          return next;
        });
      }
      flashSaved(levelIndex);
    } catch (e) {
      setError(String(e));
    }
  }

  /** Names each target folder after the folder it sits in: the folders in "Projects" take "Projects". */
  async function inheritParentName(levelIndex: number) {
    const level = levels[levelIndex];
    const { targets } = levelTargets(level);
    const wanted = new Set(targets.map((n) => n.folder_path));
    const byName = new Map<string, string[]>();
    for (const group of level.groups) {
      const name = folderName(group.parentPath);
      const paths = group.nodes
        .filter((n) => wanted.has(n.folder_path) && labels[n.folder_path] !== name)
        .map((n) => n.folder_path);
      if (paths.length > 0) byName.set(name, [...(byName.get(name) ?? []), ...paths]);
    }
    if (byName.size === 0) return;
    setError(null);
    try {
      if (await applyNames(byName)) flashSaved(levelIndex);
    } catch (e) {
      setError(String(e));
    }
  }

  function folderMenu(e: React.MouseEvent, levelIndex: number, node: FolderTreeNode) {
    e.preventDefault();
    showContextMenu(
      [
        excluded.has(node.folder_path)
          ? { type: "item", text: "Include in Location", action: () => include(node) }
          : { type: "item", text: "Exclude from Location…", action: () => setExcluding({ node, levelIndex }) },
      ],
      { event: e }
    );
  }

  async function confirmExclude() {
    if (!excluding) return;
    const { node, levelIndex } = excluding;
    setExcluding(null);
    setError(null);
    try {
      await excludeFolder(locationId, node.folder_path);
      // Close it if it was open
      if (levels[levelIndex]?.selected.includes(node.folder_path)) toggleSelection(levelIndex, node.folder_path);
      setExcluded((prev) => new Set(prev).add(node.folder_path));
    } catch (e) {
      setError(String(e));
    }
  }

  async function include(node: FolderTreeNode) {
    setError(null);
    try {
      await includeFolder(locationId, node.folder_path);
      setExcluded((prev) => {
        const next = new Set(prev);
        next.delete(node.folder_path);
        return next;
      });
      // Index it now; progress shows in the database view
      ingestDirectory(locationId).catch(() => {});
    } catch (e) {
      setError(String(e));
    }
  }

  const rendererProps: LevelRendererProps = {
    levels,
    labels,
    savedLevel,
    folderName,
    onToggle: toggleSelection,
    onCommit: commitLevelName,
    onInherit: inheritParentName,
    excluded,
    onFolderMenu: folderMenu,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Location name + mode switch */}
      <div className="shrink-0 flex items-center gap-2 px-3 h-9 border-b border-neutral-700/60">
        <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-neutral-100">
          {rootNode.folder_name}
        </span>
        <span className="min-w-0 truncate text-[11px] text-neutral-500">
          Click to select · naming applies to the selection
        </span>
        <div className="shrink-0 flex items-center gap-px bg-neutral-800 dark:bg-neutral-700/60 rounded-md p-0.5">
          {MODES.map(({ mode: m, label }) => (
            <button
              key={m}
              onClick={() => changeMode(m)}
              className={`px-2.5 py-0.5 text-xs rounded-[5px] whitespace-nowrap ${
                mode === m
                  ? "bg-white dark:bg-neutral-500/70 text-neutral-100 shadow-sm"
                  : "text-neutral-300 hover:text-neutral-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="shrink-0 px-5 py-2 text-xs text-red-500">{error}</div>}

      <div className="flex-1 min-h-0">
        {levels.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-neutral-500 text-[13px]">
            No subfolders here.
          </div>
        ) : mode === "tiles" ? (
          <MappingTiles {...rendererProps} />
        ) : (
          <MappingColumns {...rendererProps} />
        )}
      </div>
      {dialog}
      {excluding && (
        <Dialog
          title={`Exclude “${excluding.node.folder_name}” from this location?`}
          message={`Its ${excluding.node.file_count.toLocaleString()} ${
            excluding.node.file_count === 1 ? "file is" : "files are"
          } removed from Folderbase, with any properties set on them, and it won't be scanned again. Nothing on disk or in the cloud changes. You can include it again later.`}
          onCancel={() => setExcluding(null)}
          onSubmit={confirmExclude}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setExcluding(null)}>Cancel</DialogButton>
              <DialogButton variant="default" autoFocus>
                Exclude
              </DialogButton>
            </>
          }
        />
      )}
    </div>
  );
}
