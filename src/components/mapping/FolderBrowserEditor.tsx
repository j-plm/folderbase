import { useCallback, useEffect, useRef, useState } from "react";
import { clearFolderLabel, setFolderLabel } from "../../lib/commands";
import type { FolderTreeNode, PathMappingNode } from "../../lib/commands";

// ── Types ──────────────────────────────────────────────────────────────────

interface FolderGroup {
  parentPath: string;
  nodes: FolderTreeNode[];
}

interface Level {
  depth: number;
  groups: FolderGroup[];
  selected: string[];
}

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

function getNodesAtRelativeDepth(root: FolderTreeNode, relDepth: number): FolderTreeNode[] {
  if (relDepth <= 0) return [];
  if (relDepth === 1) return root.children;
  return root.children.flatMap((c) => getNodesAtRelativeDepth(c, relDepth - 1));
}

function buildInitialLevels(rootPath: string, tree: FolderTreeNode): Level[] {
  const root = findNode(tree, rootPath);
  if (!root || root.children.length === 0) return [];
  return [{ depth: 1, groups: [{ parentPath: rootPath, nodes: root.children }], selected: [] }];
}

function pKey(rootPath: string, levelDepth: number) {
  return `${rootPath}::${levelDepth}`;
}

function initPropNames(tree: FolderTreeNode, mappings: PathMappingNode[]): Record<string, string> {
  const result: Record<string, string> = {};
  const seen = new Map<number, string>();
  for (const m of mappings) {
    if (!seen.has(m.depth)) seen.set(m.depth, m.property_name);
  }
  for (const [absDepth, name] of seen) {
    const editorDepth = absDepth - tree.depth;
    if (editorDepth > 0) result[pKey(tree.folder_path, editorDepth)] = name;
  }
  return result;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function FolderIcon({ selected, muted }: { selected: boolean; muted?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 16"
      width={28}
      height={22}
      fill="currentColor"
      className={`transition-colors shrink-0 ${
        selected ? "text-blue-400" : muted ? "text-neutral-700" : "text-neutral-500"
      }`}
    >
      <path d="M2 4a2 2 0 012-2h4.172a2 2 0 011.414.586l.828.828A2 2 0 0011.828 4H16a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V4z" />
    </svg>
  );
}

function FolderItem({
  node,
  isSelected,
  onSelect,
  onDrillIn,
}: {
  node: FolderTreeNode;
  isSelected: boolean;
  onSelect: () => void;
  onDrillIn: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function handleClick() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    } else {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onSelect();
      }, 220);
    }
  }

  function handleDoubleClick() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    onDrillIn();
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={node.folder_name}
      className={`flex flex-col items-center gap-0.5 p-1.5 rounded cursor-pointer select-none transition-colors w-16 ${
        isSelected
          ? "bg-blue-500/15 border border-blue-500/40"
          : "border border-transparent hover:bg-neutral-800/60"
      }`}
    >
      <FolderIcon selected={isSelected} />
      <span className={`text-[10px] leading-tight text-center w-full truncate transition-colors ${isSelected ? "text-blue-300" : "text-neutral-400"}`}>
        {node.folder_name}
      </span>
    </div>
  );
}

function PropNameInput({
  value,
  showSaved,
  onChange,
}: {
  value: string;
  showSaved: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="w-40 shrink-0 border-r border-neutral-700/60 px-3 py-2 flex flex-col gap-0.5">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="property name"
        spellCheck={false}
        className="bg-transparent text-xs text-neutral-200 placeholder-neutral-700 outline-none border-b border-transparent focus:border-blue-400 transition-colors w-full py-px"
      />
      <span className={`text-[9px] text-green-400 leading-none transition-opacity duration-300 ${showSaved ? "opacity-100" : "opacity-0"}`}>
        saved
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function FolderBrowserEditor({ locationId, rootNode, initialMappings }: Props) {
  const [currentRootPath, setCurrentRootPath] = useState(rootNode.folder_path);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [levels, setLevels] = useState<Level[]>(() => buildInitialLevels(rootNode.folder_path, rootNode));
  const [propNames, setPropNames] = useState<Record<string, string>>(() => initPropNames(rootNode, initialMappings));
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => () => { Object.values(saveTimers.current).forEach(clearTimeout); }, []);

  const isAtRoot = history.length === 0;
  const currentRootName =
    findNode(rootNode, currentRootPath)?.folder_name ??
    currentRootPath.split("/").pop() ??
    currentRootPath;

  // Breadcrumb: all history rootPaths + current root
  const crumbs = [
    ...history.map((h) => ({
      name: findNode(rootNode, h.rootPath)?.folder_name ?? h.rootPath.split("/").pop() ?? h.rootPath,
      rootPath: h.rootPath,
    })),
    { name: currentRootName, rootPath: currentRootPath },
  ];

  function navigateToCrumb(crumbIndex: number) {
    // crumbIndex < history.length means it's an ancestor in history
    if (crumbIndex >= history.length) return;
    const entry = history[crumbIndex];
    setCurrentRootPath(entry.rootPath);
    setLevels(entry.levels);
    setHistory(history.slice(0, crumbIndex));
  }

  function goBack() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCurrentRootPath(prev.rootPath);
    setLevels(prev.levels);
  }

  function drillIn(folderPath: string) {
    const node = findNode(rootNode, folderPath);
    if (!node) return;
    setHistory((prev) => [...prev, { rootPath: currentRootPath, levels }]);
    setCurrentRootPath(folderPath);
    setLevels(buildInitialLevels(folderPath, rootNode));

    const patch: Record<string, string> = {};
    for (let d = 1; d <= 6; d++) {
      const nodes = getNodesAtRelativeDepth(node, d);
      for (const n of nodes) {
        const m = initialMappings.find((m) => m.folder_path === n.folder_path);
        if (m) { patch[pKey(folderPath, d)] = m.property_name; break; }
      }
    }
    if (Object.keys(patch).length > 0) setPropNames((prev) => ({ ...prev, ...patch }));
  }

  function toggleSelection(levelIndex: number, folderPath: string) {
    setLevels((prev) => {
      const level = prev[levelIndex];
      const isSelected = level.selected.includes(folderPath);
      const newSelected = isSelected
        ? level.selected.filter((p) => p !== folderPath)
        : [...level.selected, folderPath];

      const base: Level[] = [...prev.slice(0, levelIndex), { ...level, selected: newSelected }];
      if (newSelected.length === 0) return base;

      const newGroups: FolderGroup[] = newSelected.flatMap((selPath) => {
        const selNode = findNode(rootNode, selPath);
        return selNode && selNode.children.length > 0
          ? [{ parentPath: selPath, nodes: selNode.children }]
          : [];
      });

      if (newGroups.length === 0) return base;
      return [...base, { depth: levelIndex + 2, groups: newGroups, selected: [] }];
    });
  }

  const doSave = useCallback(
    async (levelDepth: number, name: string, rootPath: string) => {
      const root = findNode(rootNode, rootPath);
      if (!root) return;
      const nodes = getNodesAtRelativeDepth(root, levelDepth);
      if (name.trim()) {
        await Promise.allSettled(nodes.map((n) => setFolderLabel(locationId, n.folder_path, name.trim())));
      } else {
        await Promise.allSettled(nodes.map((n) => clearFolderLabel(locationId, n.folder_path)));
      }
      const key = pKey(rootPath, levelDepth);
      setSavedKeys((prev) => new Set(prev).add(key));
      setTimeout(() => setSavedKeys((prev) => { const s = new Set(prev); s.delete(key); return s; }), 1400);
    },
    [locationId, rootNode]
  );

  function handlePropNameChange(levelIndex: number, value: string) {
    const depth = levels[levelIndex].depth;
    const key = pKey(currentRootPath, depth);
    setPropNames((prev) => ({ ...prev, [key]: value }));

    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    const capturedRoot = currentRootPath;
    const capturedDepth = depth;
    saveTimers.current[key] = setTimeout(() => {
      delete saveTimers.current[key];
      doSave(capturedDepth, value, capturedRoot);
    }, 400);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-neutral-700/60 bg-neutral-800/30">
        <div className="flex items-center gap-1 text-xs min-w-0 flex-1 flex-wrap">
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={crumb.rootPath} className="flex items-center gap-1 min-w-0">
                {i > 0 && <span className="text-neutral-700 shrink-0">/</span>}
                {isLast ? (
                  <span className="text-neutral-200 font-medium truncate max-w-[160px]">{crumb.name}</span>
                ) : (
                  <button
                    onClick={() => navigateToCrumb(i)}
                    className="text-neutral-500 hover:text-blue-400 transition-colors truncate max-w-[160px]"
                  >
                    {crumb.name}
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <span className="shrink-0 text-[10px] text-neutral-700 ml-3">
          click to expand · double-click to drill in
        </span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {/* Current root folder */}
        <div className="flex">
          <div className="w-40 shrink-0 border-r border-neutral-700/60" />
          <div className="flex-1 py-2 px-2">
            <div
              onClick={isAtRoot ? undefined : goBack}
              title={isAtRoot ? currentRootName : "Back to previous view"}
              className={`flex flex-col items-center gap-0.5 p-1.5 rounded w-16 select-none transition-colors ${
                isAtRoot
                  ? "cursor-default border border-transparent"
                  : "cursor-pointer border border-transparent hover:bg-neutral-800/60"
              }`}
            >
              <FolderIcon selected={false} muted={isAtRoot} />
              <span className={`text-[10px] leading-tight text-center w-full truncate ${isAtRoot ? "text-neutral-600" : "text-neutral-400"}`}>
                {currentRootName}
              </span>
            </div>
          </div>
        </div>

        {/* Property level rows */}
        {levels.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-neutral-600 text-xs">
            No subfolders here.
          </div>
        ) : (
          levels.map((level, levelIndex) => {
            const key = pKey(currentRootPath, level.depth);
            return (
              <div key={key} className="flex">
                <PropNameInput
                  value={propNames[key] ?? ""}
                  showSaved={savedKeys.has(key)}
                  onChange={(v) => handlePropNameChange(levelIndex, v)}
                />
                <div className="flex-1 overflow-x-auto flex items-start py-2 px-2">
                  {level.groups.map((group, gi) => (
                    <div key={group.parentPath} className="flex items-start">
                      {gi > 0 && (
                        <div className="self-stretch w-px bg-neutral-700/50 mx-2 shrink-0" />
                      )}
                      <div className="flex flex-wrap gap-1">
                        {group.nodes.map((node) => (
                          <FolderItem
                            key={node.folder_path}
                            node={node}
                            isSelected={level.selected.includes(node.folder_path)}
                            onSelect={() => toggleSelection(levelIndex, node.folder_path)}
                            onDrillIn={() => drillIn(node.folder_path)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
