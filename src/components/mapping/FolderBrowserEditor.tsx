import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  clearFolderLabels,
  countMappingConflicts,
  createProperty,
  deleteProperty,
  excludeFolder,
  includeFolder,
  ingestDirectory,
  renameProperty,
  setFolderLabels,
  updatePropertyType,
} from "../../lib/commands";
import type { FolderTreeNode, PathMappingNode } from "../../lib/commands";
import { useOverwriteConfirm } from "../shared/OverwriteDialog";
import Dialog, { DialogButton, DialogField, dialogTextField } from "../shared/Dialog";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import { hasPrimaryModifier, labels as platformLabels } from "../../lib/platform";
import { EXTRACTED_KEYS, parseConfig, propertyLabel, typeLabel } from "../../lib/propertyTypes";
import { describeCondition } from "../../lib/scopes";
import type { ValueType } from "../../types";
import { useFolderSource } from "../folders/useFolderSource";
import {
  InheritNameButton,
  clickSelection,
  levelCaption,
  levelCoverage,
  levelExtension,
  levelNodes,
  levelTargets,
  rebuildLevels,
  selectAllInLevel,
  type FolderNoteText,
  type Level,
  type LevelLayoutProps,
} from "./levels";
import LevelColumns from "./LevelColumns";
import LevelTiles from "./LevelTiles";
import PropertyStrip from "./PropertyStrip";

type Mode = "tiles" | "columns";

const MODE_KEY = "mapping-editor-mode";
const MODES: { mode: Mode; label: string }[] = [
  { mode: "tiles", label: "Icons" },
  { mode: "columns", label: "Columns" },
];

/** Types a folder's name can be a value of; a new property is a Multi-select unless chosen otherwise. */
const NAME_TYPES: ValueType[] = ["array", "enum", "free_text"];

interface Props {
  locationId: string;
  rootNode: FolderTreeNode;
  initialMappings: PathMappingNode[];
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function indexNodes(tree: FolderTreeNode, into = new Map<string, FolderTreeNode>()): Map<string, FolderTreeNode> {
  into.set(tree.folder_path, tree);
  for (const child of tree.children) indexNodes(child, into);
  return into;
}

function excludedPaths(tree: FolderTreeNode, into = new Set<string>()): Set<string> {
  if (tree.excluded) into.add(tree.folder_path);
  for (const child of tree.children) excludedPaths(child, into);
  return into;
}

function buildInitialLevels(root: FolderTreeNode): Level[] {
  if (root.children.length === 0) return [];
  return [{ groups: [{ parentPath: root.folder_path, nodes: root.children }], selected: [] }];
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
 * per-folder names; Icons and Columns are two renderings of the same state.
 */
export default function FolderBrowserEditor({ locationId, rootNode, initialMappings }: Props) {
  const [mode, setMode] = useState<Mode>(loadMode);
  const [levels, setLevels] = useState<Level[]>(() => buildInitialLevels(rootNode));
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
  /** New Property…, while its name and type are being chosen, for the level it will name. */
  const [creating, setCreating] = useState<{ levelIndex: number; name: string; type: ValueType; error?: string } | null>(null);
  const nodeByPath = useMemo(() => indexNodes(rootNode), [rootNode]);
  const { library, properties, propertyOf, typeOf, scopes, reload } = useFolderSource(locationId);
  /** A property being renamed, retyped (when that would join values) or deleted, from its pill's menu. */
  const [managing, setManaging] = useState<
    | { kind: "rename"; name: string; text: string; error?: string }
    | { kind: "retype"; name: string; type: ValueType }
    | { kind: "delete"; name: string }
    | null
  >(null);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  /** Properties a folder's name can be a value of: Multi-select, Select and Text, and any already mapped. */
  const nameProperties = useMemo(() => {
    const names = properties.filter((n) => !EXTRACTED_KEYS.has(n) && NAME_TYPES.includes(typeOf(n)));
    return [...new Set([...names, ...Object.values(labels)])].sort((a, b) => a.localeCompare(b));
  }, [properties, typeOf, labels]);

  /** An unnamed folder in a level whose named folders share a name: the name it would take. */
  const pending = useMemo(() => {
    const map = new Map<string, string>();
    for (const level of levels) {
      const { name } = levelCoverage(levelNodes(level), labels);
      if (!name) continue;
      for (const n of levelNodes(level)) if (!labels[n.folder_path] && !excluded.has(n.folder_path)) map.set(n.folder_path, name);
    }
    return map;
  }, [levels, labels, excluded]);

  function folderName(path: string): string {
    return nodeByPath.get(path)?.folder_name ?? path.split("/").pop() ?? path;
  }

  function childrenOf(path: string): FolderTreeNode[] {
    // An excluded folder's contents aren't part of the location
    return excluded.has(path) ? [] : (nodeByPath.get(path)?.children ?? []);
  }

  function changeMode(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // ignore
    }
  }

  /** Sets a level's selection; the levels below follow it, keeping what's still shown open. */
  function select(levelIndex: number, selected: (level: Level) => string[]) {
    setLevels((prev) => {
      const next = [...prev];
      next[levelIndex] = { ...prev[levelIndex], selected: selected(prev[levelIndex]) };
      return rebuildLevels(next, levelIndex, childrenOf);
    });
  }

  function toggleSelection(levelIndex: number, folderPath: string, shiftKey = false) {
    const from = anchor.current?.levelIndex === levelIndex ? anchor.current.path : null;
    anchor.current = { levelIndex, path: folderPath };
    select(levelIndex, (level) => clickSelection(level, folderPath, from, shiftKey));
  }

  /** Every folder in the level, so the next level shows all their folders; with `toggle`, none when all already are. */
  function selectLevel(levelIndex: number, toggle = false) {
    const level = levels[levelIndex];
    if (!level) return;
    const first = levelNodes(level)[0];
    if (first) anchor.current = { levelIndex, path: first.folder_path };
    select(levelIndex, (l) => selectAllInLevel(l, toggle));
  }

  /** The level the keyboard acts on: the last one clicked, else the deepest with a selection. */
  function activeLevel(): number {
    const clicked = anchor.current?.levelIndex;
    if (clicked !== undefined && clicked < levels.length) return clicked;
    return Math.max(0, levels.map((l) => l.selected.length > 0).lastIndexOf(true));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.target as Element).closest("input, textarea, select")) return;
    if (hasPrimaryModifier(e) && e.key === "a") {
      e.preventDefault();
      e.stopPropagation();
      selectLevel(activeLevel());
    } else if (e.key === "Escape" && levels[activeLevel()]?.selected.length) {
      e.stopPropagation();
      select(activeLevel(), () => []);
    }
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
    // A name that wasn't a property yet is one now
    if ([...byName.keys()].some((name) => !properties.includes(name))) void reload().catch(() => {});
    return true;
  }

  /** Maps these folders to one property, flashing "Saved" on the level. */
  async function mapFolders(levelIndex: number, name: string, paths: string[]) {
    if (paths.length === 0) return;
    setError(null);
    try {
      if (await applyNames(new Map([[name, paths]]))) flashSaved(levelIndex);
    } catch (e) {
      setError(String(e));
    }
  }

  /**
   * Names the level's target folders (see `levelTargets`: the selected ones when
   * only some are selected, otherwise all of them) with a property. Folders that
   * already carry it are left as they are, so naming again fills the gaps.
   */
  function nameLevel(levelIndex: number, name: string) {
    const { targets } = levelTargets(levels[levelIndex]);
    const paths = targets
      .filter((n) => labels[n.folder_path] !== name && !excluded.has(n.folder_path))
      .map((n) => n.folder_path);
    void mapFolders(levelIndex, name, paths);
  }

  /** Takes a property off the level's target folders that carry it. */
  async function unnameLevel(levelIndex: number, name: string) {
    const { targets } = levelTargets(levels[levelIndex]);
    const paths = targets.filter((n) => labels[n.folder_path] === name).map((n) => n.folder_path);
    if (paths.length === 0) return;
    setError(null);
    try {
      await clearFolderLabels(locationId, paths);
      setLabels((prev) => {
        const next = { ...prev };
        for (const p of paths) delete next[p];
        return next;
      });
      flashSaved(levelIndex);
    } catch (e) {
      setError(String(e));
    }
  }

  /**
   * A pill's menu: take it off these folders, or change the property itself as
   * the Database view's header does (the built-in Tags can only be renamed).
   */
  function pillMenu(e: React.MouseEvent, levelIndex: number, name: string) {
    e.preventDefault();
    const { targets } = levelTargets(levels[levelIndex]);
    const count = targets.filter((n) => labels[n.folder_path] === name).length;
    const prop = propertyOf(name);
    const builtIn = parseConfig(prop).system === "tags";
    const type = typeOf(name);
    const entries: MenuEntry[] = [
      ...(count > 0
        ? [
            {
              type: "item" as const,
              text: `Remove “${propertyLabel(name)}” from ${count} Folder${count === 1 ? "" : "s"}`,
              action: () => void unnameLevel(levelIndex, name),
            },
            { type: "separator" as const },
          ]
        : []),
      { type: "item", text: "Rename Property…", enabled: !!prop, action: () => setManaging({ kind: "rename", name, text: name }) },
      {
        type: "submenu",
        text: "Property Type",
        items: NAME_TYPES.map((t) => ({
          type: "check" as const,
          text: typeLabel(t),
          checked: type === t,
          enabled: !!prop && !builtIn,
          action: () => {
            if (t === type) return;
            // A Multi-select's several values per file are joined into one
            if (type === "array") setManaging({ kind: "retype", name, type: t });
            else void retype(name, t);
          },
        })),
      },
      { type: "separator" },
      { type: "item", text: "Delete Property…", enabled: !!prop && !builtIn, action: () => setManaging({ kind: "delete", name }) },
    ];
    showContextMenu(entries, { event: e });
  }

  async function renameNamed(from: string, text: string) {
    const to = text.trim();
    if (!to || to === from) {
      setManaging(null);
      return;
    }
    const clash = properties.find((p) => p !== from && p.toLowerCase() === to.toLowerCase());
    const prop = propertyOf(from);
    if (clash || !prop) {
      setManaging({ kind: "rename", name: from, text, error: clash ? `“${clash}” already exists` : `“${from}” isn't a property` });
      return;
    }
    try {
      await renameProperty(prop.property_id, to);
      // Its folder mappings are renamed with it
      setLabels((prev) => Object.fromEntries(Object.entries(prev).map(([path, n]) => [path, n === from ? to : n])));
      setManaging(null);
      await reload();
    } catch (e) {
      setManaging({ kind: "rename", name: from, text, error: String(e) });
    }
  }

  async function retype(name: string, type: ValueType) {
    setManaging(null);
    const prop = propertyOf(name);
    if (!prop) return;
    setError(null);
    try {
      await updatePropertyType(prop.property_id, type, null);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteNamed(name: string) {
    setManaging(null);
    const prop = propertyOf(name);
    if (!prop) return;
    setError(null);
    try {
      await deleteProperty(prop.property_id);
      // Folders mapped to it are unmapped with it
      setLabels((prev) => Object.fromEntries(Object.entries(prev).filter(([, n]) => n !== name)));
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  /** New Property… ▸ Create: makes the property with the chosen type, then names the level with it. */
  async function createNameProperty() {
    if (!creating) return;
    const name = creating.name.trim();
    if (!name) return;
    const existing = properties.find((p) => p.toLowerCase() === name.toLowerCase());
    if (existing) {
      setCreating({ ...creating, error: `“${existing}” already exists: choose it from the list` });
      return;
    }
    try {
      await createProperty(name, library, creating.type);
      await reload();
      setCreating(null);
      nameLevel(creating.levelIndex, name);
    } catch (e) {
      setCreating({ ...creating, error: String(e) });
    }
  }

  function conditionOf(name: string): string | undefined {
    const scope = scopes.find((s) => s.property === name && s.conditions.length > 0);
    if (!scope) return undefined;
    return `Only where ${scope.conditions.map((c) => describeCondition(c, propertyLabel(c.property))).join(scope.all ? " and " : " or ")}`;
  }

  /** The level's heading: the name its folders carry, or what naming it will do. */
  function headingText(levelIndex: number): { text: string; placeholder: boolean } {
    const level = levels[levelIndex];
    const all = levelCoverage(levelNodes(level), labels);
    if (all.mixed) return { text: all.summary, placeholder: false };
    if (all.name) return { text: propertyLabel(all.name), placeholder: false };
    const { targets, partial } = levelTargets(level);
    if (partial) return { text: `Name ${targets.length} of ${levelNodes(level).length} folders`, placeholder: true };
    return { text: "Name this level", placeholder: true };
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

  const rendererProps: LevelLayoutProps<FolderTreeNode> = {
    levels,
    heading: (levelIndex, layout) => {
      const { text, placeholder } = headingText(levelIndex);
      const targets = levelTargets(levels[levelIndex]).targets;
      const coverage = levelCoverage(targets, labels);
      const strip = (
        <PropertyStrip
          properties={nameProperties}
          typeOf={typeOf}
          current={coverage.name}
          present={new Set(levelCoverage(levelNodes(levels[levelIndex]), labels).counts.keys())}
          conditionOf={conditionOf}
          collapsible={layout === "columns"}
          onApply={(name) => nameLevel(levelIndex, name)}
          onMenu={(e, name) => pillMenu(e, levelIndex, name)}
          onNewProperty={() => setCreating({ levelIndex, name: "", type: "array" })}
        />
      );
      const nameClass = placeholder ? "text-neutral-500" : "font-semibold text-neutral-100";
      // Icons: the name, its properties and the caption share one line, as a group heading does
      if (layout === "tiles") {
        return (
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className={`shrink-0 max-w-[35%] truncate text-[13px] ${nameClass}`}>{text}</span>
            <InheritNameButton onClick={() => inheritParentName(levelIndex)} />
            <div className="flex-1 min-w-0">{strip}</div>
          </div>
        );
      }
      return (
        <>
          <div className="flex items-center gap-1 min-w-0">
            <span className={`flex-1 min-w-0 truncate text-[13px] ${nameClass}`}>{text}</span>
            <InheritNameButton onClick={() => inheritParentName(levelIndex)} />
          </div>
          {strip}
        </>
      );
    },
    headingText: (levelIndex) => headingText(levelIndex).text,
    caption: (levelIndex) => {
      const level = levels[levelIndex];
      const saved = savedLevel === levelIndex;
      const extension = saved ? null : levelExtension(level, labels, (p) => excluded.has(p));
      return (
        <>
          <span className="min-w-0 truncate">{levelCaption(level, saved, folderName, labels)}</span>
          {extension && (
            <button
              type="button"
              title={`Map ${extension.paths.length === 1 ? "it" : "them"} to ${propertyLabel(extension.name)} too`}
              onClick={() => void mapFolders(levelIndex, extension.name, extension.paths)}
              className="shrink-0 text-blue-400 hover:underline"
            >
              Apply to {extension.paths.length} {extension.partial ? "Selected" : "More"}
            </button>
          )}
        </>
      );
    },
    onHeadingClick: (levelIndex) => selectLevel(levelIndex, true),
    folderName,
    onToggle: toggleSelection,
    onFolderMenu: folderMenu,
    note: (node): FolderNoteText | undefined => {
      if (excluded.has(node.folder_path)) return { text: "Excluded", title: "Excluded from this location" };
      const name = labels[node.folder_path];
      if (name) return { text: name, title: `Mapped to ${name}` };
      const would = pending.get(node.folder_path);
      return would ? { text: would, title: `Not mapped yet: the other folders here are mapped to ${would}`, faded: true } : undefined;
    },
    dimmed: (node) => excluded.has(node.folder_path),
    hasChildren: (node) => node.children.length > 0 && !excluded.has(node.folder_path),
  };

  return (
    <div className="flex flex-col h-full">
      {/* Location name + mode switch */}
      <div className="shrink-0 flex items-center gap-2 px-3 h-9 border-b border-neutral-700/60">
        <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-neutral-100">
          {rootNode.folder_name}
        </span>
        <span className="min-w-0 truncate text-[11px] text-neutral-500">
          Click to select · {platformLabels.selectAll} selects a column · a property names the selection
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

      {/* Focusable, so ⌘A and Escape act on these folders rather than on the view behind */}
      <div tabIndex={-1} onKeyDown={onKeyDown} className="flex-1 min-h-0 outline-none">
        {levels.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-neutral-500 text-[13px]">
            No subfolders here.
          </div>
        ) : mode === "tiles" ? (
          <LevelTiles {...rendererProps} />
        ) : (
          <LevelColumns {...rendererProps} />
        )}
      </div>
      {dialog}
      {creating && (
        <Dialog
          title="New Property"
          message="The selected folders' names become its values, for every file inside them."
          onCancel={() => setCreating(null)}
          onSubmit={() => void createNameProperty()}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setCreating(null)}>Cancel</DialogButton>
              <DialogButton variant="default" disabled={!creating.name.trim()}>
                Create
              </DialogButton>
            </>
          }
        >
          <DialogField label="Name:">
            <input
              autoFocus
              value={creating.name}
              onChange={(e) => setCreating({ ...creating, name: e.target.value, error: undefined })}
              spellCheck={false}
              className={dialogTextField}
            />
          </DialogField>
          <DialogField label="Type:">
            <select
              value={creating.type}
              onChange={(e) => setCreating({ ...creating, type: e.target.value as ValueType })}
              className={dialogTextField}
            >
              {NAME_TYPES.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </select>
          </DialogField>
          {creating.error && <p className="text-xs text-red-500">{creating.error}</p>}
        </Dialog>
      )}
      {managing?.kind === "rename" && (
        <Dialog
          title={`Rename “${propertyLabel(managing.name)}”`}
          message="Files, folder mappings, views and rules that use it follow the new name."
          onCancel={() => setManaging(null)}
          onSubmit={() => void renameNamed(managing.name, managing.text)}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setManaging(null)}>Cancel</DialogButton>
              <DialogButton variant="default" disabled={!managing.text.trim()}>
                Rename
              </DialogButton>
            </>
          }
        >
          <DialogField label="Name:">
            <input
              autoFocus
              value={managing.text}
              onChange={(e) => setManaging({ ...managing, text: e.target.value, error: undefined })}
              onFocus={(e) => e.currentTarget.select()}
              spellCheck={false}
              className={dialogTextField}
            />
          </DialogField>
          {managing.error && <p className="text-xs text-red-500">{managing.error}</p>}
        </Dialog>
      )}
      {managing?.kind === "retype" && (
        <Dialog
          title={`Change “${propertyLabel(managing.name)}” to ${typeLabel(managing.type)}?`}
          message={`Files with several ${propertyLabel(managing.name)} values have them joined into one, in every location of this library.`}
          onCancel={() => setManaging(null)}
          onSubmit={() => void retype(managing.name, managing.type)}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setManaging(null)}>Cancel</DialogButton>
              <DialogButton variant="default" autoFocus>
                Change
              </DialogButton>
            </>
          }
        />
      )}
      {managing?.kind === "delete" && (
        <Dialog
          title={`Delete “${propertyLabel(managing.name)}”?`}
          message={(() => {
            const mapped = Object.values(labels).filter((n) => n === managing.name).length;
            return `The property and its values are removed from every file in this library${
              mapped > 0 ? `, and the ${mapped} folder${mapped === 1 ? "" : "s"} here mapped to it are unmapped` : ""
            }. This can't be undone.`;
          })()}
          onCancel={() => setManaging(null)}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setManaging(null)}>Cancel</DialogButton>
              <DialogButton variant="destructive" onClick={() => void deleteNamed(managing.name)}>
                Delete
              </DialogButton>
            </>
          }
        />
      )}
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
