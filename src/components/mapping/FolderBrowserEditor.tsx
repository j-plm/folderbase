import { useEffect, useRef, useState } from "react";
import { clearFolderLabel, setFolderLabel } from "../../lib/commands";
import type { FolderTreeNode, PathMappingNode } from "../../lib/commands";
import { SymbolIcon } from "../../lib/fileIcons";
import { levelNodes, type FolderGroup, type Level, type LevelRendererProps } from "./levels";
import MappingColumns from "./MappingColumns";
import MappingTiles from "./MappingTiles";

type Mode = "tiles" | "columns";

const MODE_KEY = "mapping-editor-mode";
const MODES: { mode: Mode; label: string }[] = [
  { mode: "tiles", label: "Tiles" },
  { mode: "columns", label: "Columns" },
];

interface HistoryEntry {
  rootPath: string;
  levels: Level[];
}

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
  const [currentRootPath, setCurrentRootPath] = useState(rootNode.folder_path);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [levels, setLevels] = useState<Level[]>(() => buildInitialLevels(rootNode.folder_path, rootNode));
  // Property name per folder path — mappings are stored per folder, never per depth.
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialMappings.map((m) => [m.folder_path, m.property_name]))
  );
  const [savedLevel, setSavedLevel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  function folderName(path: string): string {
    return findNode(rootNode, path)?.folder_name ?? path.split("/").pop() ?? path;
  }

  const crumbs = [
    ...history.map((h) => ({ name: folderName(h.rootPath), rootPath: h.rootPath })),
    { name: folderName(currentRootPath), rootPath: currentRootPath },
  ];

  function changeMode(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // ignore
    }
  }

  function navigateToCrumb(crumbIndex: number) {
    if (crumbIndex < 0 || crumbIndex >= history.length) return;
    const entry = history[crumbIndex];
    setCurrentRootPath(entry.rootPath);
    setLevels(entry.levels);
    setHistory(history.slice(0, crumbIndex));
  }

  function drillIn(folderPath: string) {
    if (!findNode(rootNode, folderPath)) return;
    setHistory((prev) => [...prev, { rootPath: currentRootPath, levels }]);
    setCurrentRootPath(folderPath);
    setLevels(buildInitialLevels(folderPath, rootNode));
  }

  function toggleSelection(levelIndex: number, folderPath: string) {
    setLevels((prev) => {
      const level = prev[levelIndex];
      const isSelected = level.selected.includes(folderPath);
      const newSelected = isSelected
        ? level.selected.filter((p) => p !== folderPath)
        : [...level.selected, folderPath];

      const base: Level[] = [...prev.slice(0, levelIndex), { ...level, selected: newSelected }];

      const newGroups: FolderGroup[] = newSelected.flatMap((selPath) => {
        const selNode = findNode(rootNode, selPath);
        return selNode && selNode.children.length > 0
          ? [{ parentPath: selPath, nodes: selNode.children }]
          : [];
      });

      if (newGroups.length === 0) return base;
      return [...base, { groups: newGroups, selected: [] }];
    });
  }

  /** Names exactly the folders shown in this level, i.e. the children of the selected parents. */
  async function commitLevelName(levelIndex: number, name: string) {
    const trimmed = name.trim();
    const nodes = levelNodes(levels[levelIndex]);
    const targets = trimmed
      ? nodes.filter((n) => labels[n.folder_path] !== trimmed)
      : nodes.filter((n) => labels[n.folder_path]);
    if (targets.length === 0) return;

    setError(null);
    const done: Record<string, string> = {};
    const cleared: string[] = [];
    // Sequential: each call is its own SQLite write transaction.
    for (const n of targets) {
      try {
        if (trimmed) {
          await setFolderLabel(locationId, n.folder_path, trimmed);
          done[n.folder_path] = trimmed;
        } else {
          await clearFolderLabel(locationId, n.folder_path);
          cleared.push(n.folder_path);
        }
      } catch (e) {
        setError(String(e));
      }
    }
    setLabels((prev) => {
      const next = { ...prev, ...done };
      for (const p of cleared) delete next[p];
      return next;
    });

    setSavedLevel(levelIndex);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedLevel(null), 1400);
  }

  const rendererProps: LevelRendererProps = {
    levels,
    labels,
    savedLevel,
    folderName,
    onToggle: toggleSelection,
    onCommit: commitLevelName,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb + mode switch */}
      <div className="shrink-0 flex items-center gap-2 px-3 h-9 border-b border-neutral-700/60">
        <button
          onClick={() => navigateToCrumb(history.length - 1)}
          disabled={history.length === 0}
          title="Back"
          className="flex items-center justify-center w-6 h-6 rounded-md text-neutral-300 hover:bg-neutral-700/60 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <SymbolIcon name="chevron.left" size={12} fallback="‹" />
        </button>
        <div className="flex items-center gap-1 text-[13px] min-w-0 flex-1">
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={crumb.rootPath} className="flex items-center gap-1 min-w-0">
                {i > 0 && <SymbolIcon name="chevron.right" size={9} fallback="›" className="text-neutral-500" />}
                {isLast ? (
                  <span className="text-neutral-100 font-medium truncate">{crumb.name}</span>
                ) : (
                  <button
                    onClick={() => navigateToCrumb(i)}
                    className="text-neutral-400 hover:text-neutral-100 truncate"
                  >
                    {crumb.name}
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <span className="min-w-0 truncate text-[11px] text-neutral-500">
          {mode === "tiles"
            ? "Click to expand · double-click to open"
            : "Click to expand · select several to group"}
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
          <MappingTiles {...rendererProps} onDrillIn={drillIn} />
        ) : (
          <MappingColumns {...rendererProps} />
        )}
      </div>
    </div>
  );
}
