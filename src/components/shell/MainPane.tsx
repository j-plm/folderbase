import { useMemo, type CSSProperties } from "react";
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
import type { MenuEntry } from "../../lib/nativeMenu";
import { getLocations } from "../../lib/commands";
import PathBar, { type PathSegment } from "./PathBar";
import NewFolderDialog from "./NewFolderDialog";

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
  // With single folders skipped, a folder's menu is the folder it opens into
  const folderMenu = (value: string) => folderMenuAt(browse.opens([...place, value]));
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
    },
    ...(named
      ? [{ label: activeView.name, icon: <FolderIcon size={14} />, onOpen: () => go([]), menu: viewsMenu, menuKey: activeView.view_id }]
      : []),
    ...browse.steps.map(
      (step): PathSegment => ({
        label: step.label,
        icon: <FolderIcon size={14} />,
        onOpen: () => go(step.path),
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
          />
        )}
        {viewMode === "columns" && tree && <ColumnsView tree={tree} place={place} onPlace={go} folderMenu={folderMenuAt} opens={browse.opens} placeMenu={(path) => browse.levelMenu(path)} />}
        {viewMode === "database" && (
          <LocationDatabaseView files={files} place={tablePlace} locationId={activeLocationId} onChanged={refresh} />
        )}
      </div>
      <div style={{ ...INSET, ...CLEAR_PANEL }}>
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
