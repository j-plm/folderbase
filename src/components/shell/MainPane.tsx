import { useEffect, useMemo, type CSSProperties } from "react";
import { useNavigation } from "../../contexts/NavigationContext";
import TilesView from "../views/TilesView";
import ListView from "../views/ListView";
import ColumnsView from "../views/ColumnsView";
import LocationDatabaseView, { type TablePlace } from "../views/LocationDatabaseView";
import PathMappingPanel from "../mapping/PathMappingPanel";
import HierarchyPanel from "../folders/HierarchyPanel";
import { useBrowse } from "../../contexts/BrowseContext";
import { useBrowseKeys } from "../../hooks/useBrowseKeys";
import { useOptionalLocationViews } from "../../contexts/LocationViewsContext";
import { FolderIcon } from "../../lib/fileIcons";
import { placeSteps } from "../../lib/folderTree";
import { folderLabel, planDrop, type DragItem } from "../../lib/filing";
import type { MenuEntry } from "../../lib/nativeMenu";
import { getLocations, openPaths } from "../../lib/commands";
import PathBar, { type PathSegment } from "./PathBar";
import NewFolderDialog from "./NewFolderDialog";
import { FileDragProvider, useFileDrag } from "../../contexts/FileDragContext";
import { useArrangedBy } from "../../contexts/ArrangementContext";
import { isPropertyGroup } from "../../lib/arrange";
import { ARRANGED_GROUPS } from "../../lib/fileDrag";
import type { FolderLevel } from "../../lib/tableViews";

// Content starts past the floating sidebar. Columns view applies the inset inside its own
// horizontal scroller, so earlier columns slide under the sidebar as in Finder.
const INSET = { paddingLeft: "var(--sidebar-inset)" };
/** Keeps content clear of an open side panel (Hierarchy, Map Disk Folders). */
const CLEAR_PANEL = { paddingRight: "var(--panel-width, 0px)" };

/**
 * Icons and List make room for an open side panel; Columns and Database run
 * on behind it, with room at the end (`--scroll-end`) to scroll their last
 * column out from under it.
 */
function viewStyle(mode: string): CSSProperties {
  if (mode === "columns") return { "--scroll-end": "var(--panel-width, 0px)" } as CSSProperties;
  if (mode === "database") return { ...INSET, "--scroll-end": "var(--panel-width, 0px)" } as CSSProperties;
  return { ...INSET, ...CLEAR_PANEL };
}

export default function MainPane() {
  const { activeLocationId } = useNavigation();
  // Filing by drag, and the location's undo history, in every view mode
  return (
    <FileDragProvider locationId={activeLocationId}>
      <MainPaneContent />
    </FileDragProvider>
  );
}

function MainPaneContent() {
  const drag = useFileDrag();
  const browseNow = useBrowse();
  // Grouped by a property of one value, Icons and List headings file into it (FileDragContext `registerSource`)
  const { arrangement: arranged, byProperty, groupsTakeDrops } = useArrangedBy();
  useEffect(() => {
    const column = arranged.groupBy;
    if (!drag || !browseNow || !byProperty || !groupsTakeDrops || !isPropertyGroup(column)) return;
    const level: FolderLevel = { column, direction: "asc", next: null, branches: {} };
    return drag.registerSource(ARRANGED_GROUPS, {
      context: () => browseNow.dropContextWith(level),
      fromOf: (file) => [byProperty.keyOf(file, column)?.label ?? ""],
    });
  }, [drag, browseNow, arranged.groupBy, byProperty, groupsTakeDrops]);
  const { activeLocationId, setActiveLocation, viewMode, diskFoldersLocationId, closeDiskFolders, editHierarchy, setEditHierarchy } =
    useNavigation();
  const browse = useBrowse();
  // Arrow keys move through the files and folders wherever focus is, as in Finder
  useBrowseKeys();
  const locationViews = useOptionalLocationViews();
  // The Database view shows every file under the folder you're in, grouped by the folders below it
  const tablePlace = useMemo((): TablePlace | null => {
    if (!browse) return null;
    const { tree, place, steps, filters, levelNames, viewFromFolder, groupsFor, go } = browse;
    return {
      path: place,
      within: tree && place.length > 0 ? new Set(tree.filesAt(place).map((f) => f.file_id)) : null,
      name: steps[steps.length - 1]?.label ?? null,
      filters,
      levelNames,
      newViewFrom: viewFromFolder,
      onEditHierarchy: () => setEditHierarchy(true),
      groupsFor,
      onOpen: go,
    };
  }, [browse, setEditHierarchy]);

  if (!activeLocationId || !browse) {
    return (
      <div style={INSET} className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
        Add a location to get started.
      </div>
    );
  }

  const { files, loading, refresh, tree, place, enter, go } = browse;
  // Icons and List show what's in the folder you're in: its folders, then the files sitting there
  const here = tree?.contents(place);
  const placeKey = JSON.stringify(place);

  // The path bar: the location, the view (unless it's the default), then each folder down to here. All plain
  // folders: every one is a query (the view's filters, then each folder's value), so none is set apart
  const activeView = locationViews?.active;
  const defaultView = locationViews?.views.find((v) => v.is_default);
  // A click on a segment goes there; a right-click shows what sits beside it, to go to instead:
  // the other locations, the location's other saved views, or the other folders at that level
  const named = !!activeView && !activeView.is_default;
  /** New View from Folder, where its folders on the way can be filtered for exactly. */
  const newViewEntries = (path: string[]): MenuEntry[] => {
    const made = browse.viewFromFolder(path);
    return made
      ? [{ type: "separator" }, { type: "item", text: `New View from “${made.label}”`, action: () => void made.create() }]
      : [];
  };
  /** A folder's right-click menu in Icons and List. */
  /** A folder's right-click menu: open it, its level's settings, New View from Folder. */
  const folderMenuAt = (path: string[]): MenuEntry[] => {
    const inner = browse.levelMenu(path);
    return [
      { type: "item", text: "Open", action: () => go(path) },
      ...(inner.length > 0 ? [{ type: "separator" as const }, ...inner] : []),
      ...newViewEntries(path),
      // A folder made with New Folder that nothing's been put in yet
      ...(browse.isEmptyMadeFolder(path)
        ? [{ type: "separator" as const }, { type: "item" as const, text: "Remove Empty Folder", action: () => browse.removeMadeFolder(path) }]
        : []),
    ];
  };
  // With single folders skipped, a folder's menu is the folder it opens into, and drops go there too
  const folderPath = (value: string) => browse.opens([...place, value]);
  const folderMenu = (value: string) => folderMenuAt(folderPath(value));
  /**
   * A right-click on files: Open, and Remove from “Folder”, which takes them
   * out of the folder they're shown in (its value only), into the one enclosing it.
   */
  const fileMenu = (items: DragItem[]): MenuEntry[] => {
    const files = items.flatMap((i) => (i.kind === "file" ? [i] : []));
    if (files.length === 0 || files.length < items.length) return [];
    const entries: MenuEntry[] = [{ type: "item", text: "Open", action: () => void openPaths(files.map((f) => f.file.file_path)).catch(() => {}) }];
    const from = files[0].from;
    const ctx = browse.dropContext;
    if (!from || from.length === 0 || !ctx || files.some((f) => JSON.stringify(f.from) !== JSON.stringify(from))) return entries;
    const out = from.slice(0, -1);
    // Even if the view's filters then leave them out: removing is what was asked for. Greyed where
    // the folder's value can't be taken away (it's read from the file)
    const removable = planDrop(files, out, ctx, { partial: true }).files > 0;
    return [
      ...entries,
      { type: "separator" },
      {
        type: "item",
        text: `Remove from “${folderLabel(ctx.tree, from, ctx.topLabel)}”`,
        enabled: removable,
        action: () => drag?.fileInto(files, out, { partial: true }),
      },
    ];
  };
  /** Here's folders, each merged with the single folders it holds when they're skipped ("2024 › Tax"). */
  const folders = (here?.folders ?? []).map((entry) => {
    const lands = browse.opens([...place, entry.value]);
    if (!tree || lands.length === place.length + 1) return entry;
    return { ...entry, label: placeSteps(tree, lands).slice(place.length).map((s) => s.label).join(" › ") };
  });
  /** Right-click on empty space in Icons and List: New Folder, and the settings of the level showing here. */
  const backgroundMenu = (): MenuEntry[] => [
    ...(browse.newFolderHere ? [{ type: "item" as const, text: "New Folder", action: () => browse.setNewFolderOpen(true) }] : []),
    ...browse.levelMenu(place),
  ];
  // The location's own view (its Default), at its top
  const openLocation = () => {
    if (!named) go([]);
    else if (defaultView) void locationViews?.select(defaultView.view_id);
  };
  // Beside a location: the other locations
  const locationsMenu = async (): Promise<MenuEntry[]> =>
    (await getLocations()).map((l) => ({
      type: "check",
      text: l.name,
      checked: l.location_id === activeLocationId,
      key: l.location_id,
      action: () => (l.location_id === activeLocationId ? openLocation() : setActiveLocation(l.location_id)),
    }));
  // Beside a saved view: the location's other saved views (its Default is the location itself, not a neighbour)
  const viewsMenu = (): MenuEntry[] =>
    (locationViews?.views ?? [])
      .filter((v) => !v.is_default)
      .map((v) => ({
        type: "check",
        text: v.name,
        checked: v.view_id === activeView?.view_id,
        key: v.view_id,
        action: () => (v.view_id === activeView?.view_id ? go([]) : void locationViews?.select(v.view_id)),
      }));
  const segments: PathSegment[] = [
    {
      label: browse.locationName ?? "",
      icon: <FolderIcon size={14} />,
      onOpen: openLocation,
      menu: locationsMenu,
      menuKey: activeLocationId,
      // The view's top; for a named view, its own segment takes drops there instead
      dropPath: named ? undefined : [],
    },
    ...(named
      ? [{ label: activeView.name, icon: <FolderIcon size={14} />, onOpen: () => go([]), menu: viewsMenu, menuKey: activeView.view_id, dropPath: [] }]
      : []),
    ...browse.steps.map(
      (step): PathSegment => ({
        label: step.label,
        icon: <FolderIcon size={14} />,
        onOpen: () => go(step.path),
        dropPath: step.path,
        menuKey: step.value,
        menu: () => [
          ...(tree?.contents(step.path.slice(0, -1)).folders ?? []).map(
            (f): MenuEntry => ({
              type: "check",
              text: f.label,
              checked: f.value === step.value,
              key: f.value,
              action: () => go([...step.path.slice(0, -1), f.value]),
            })
          ),
          ...newViewEntries(step.path),
        ],
      })
    ),
  ];

  if (loading && files.length === 0) {
    return (
      <div style={INSET} className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-w-0 flex flex-col">
      <div style={viewStyle(viewMode)} className="flex-1 overflow-auto flex flex-col">
        {viewMode !== "database" && !tree && (
          <div className="flex items-center justify-center flex-1 text-neutral-500 text-sm">Loading…</div>
        )}
        {/* A new folder starts at the top with nothing selected, as in Finder */}
        {viewMode === "tiles" && here && (
          <TilesView
            key={placeKey}
            files={here.files}
            folders={folders}
            onOpenFolder={enter}
            folderMenu={folderMenu}
            backgroundMenu={backgroundMenu}
            place={place}
            folderPath={folderPath}
            fileMenu={fileMenu}
          />
        )}
        {viewMode === "list" && here && (
          <ListView
            key={placeKey}
            files={here.files}
            folders={folders}
            onOpenFolder={enter}
            folderMenu={folderMenu}
            backgroundMenu={backgroundMenu}
            place={place}
            folderPath={folderPath}
            fileMenu={fileMenu}
          />
        )}
        {viewMode === "columns" && tree && (
          <ColumnsView
            tree={tree}
            place={place}
            onPlace={go}
            folderMenu={folderMenuAt}
            opens={browse.opens}
            placeMenu={(path) => browse.levelMenu(path)}
            fileMenu={fileMenu}
          />
        )}
        {viewMode === "database" && (
          <LocationDatabaseView files={files} place={tablePlace} locationId={activeLocationId} onChanged={refresh} />
        )}
      </div>
      <div style={{ ...INSET, ...CLEAR_PANEL }} className="relative">
        <DropDetails />
        <PathBar segments={segments} />
      </div>
      <NewFolderDialog />
      {diskFoldersLocationId === activeLocationId && (
        <PathMappingPanel
          locationId={activeLocationId}
          onClose={() => {
            closeDiskFolders();
            refresh();
          }}
        />
      )}
      {editHierarchy && (
        <HierarchyPanel locationId={activeLocationId} files={files} onClose={() => setEditHierarchy(false)} />
      )}
    </div>
  );
}

/**
 * While dragging over a folder, what the drop would change, level by level,
 * in a bar just above the path bar (the cursor only says the gist).
 */
function DropDetails() {
  const status = useFileDrag()?.status;
  if (!status || status.details.length === 0) return null;
  return (
    <div className="absolute inset-x-0 bottom-full flex items-center h-[28px] px-3 overflow-hidden border-t border-neutral-700/60 bg-neutral-900 text-[12px] text-neutral-400 whitespace-nowrap select-none pointer-events-none">
      <span className="font-semibold text-neutral-100 shrink-0">{status.title}</span>
      <span className="truncate">
        {status.details.map((d) => (
          <span key={d}>
            <span className="mx-1.5">·</span>
            {d}
          </span>
        ))}
      </span>
    </div>
  );
}
