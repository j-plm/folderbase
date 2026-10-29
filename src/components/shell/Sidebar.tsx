import { useEffect, useState } from "react";
import type React from "react";
import { useNavigation } from "../../contexts/NavigationContext";
import { listen } from "@tauri-apps/api/event";
import {
  getLocations,
  getLocationViews,
  clearDatabase,
  deleteLocation,
  ingestDirectory,
  renameLocation,
  reorderLocations,
} from "../../lib/commands";
import type { Location } from "../../lib/commands";
import AddLocationModal from "./AddLocationModal";
import Dialog, { DialogButton } from "../shared/Dialog";
import AddedFolderSheet from "./AddedFolderSheet";
import RenameField from "../shared/RenameField";
import { SymbolIcon } from "../../lib/fileIcons";
import { showContextMenu } from "../../lib/nativeMenu";
import { useOptionalLocationViews } from "../../contexts/LocationViewsContext";
import { DEFAULT_VIEW_NAME, type StoredView } from "../../lib/tableViews";
import { DefaultBadge } from "./ViewsButton";
import { useDragReorder } from "../../hooks/useDragReorder";
import { moveColumnId } from "../../lib/columns";

const MIN_WIDTH = 150;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 220;
const WIDTH_KEY = "sidebar-width";
const PANEL_MARGIN = 8;

function loadWidth(): number {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH;
}

export default function Sidebar() {
  const { activeLocationId, setActiveLocation, openDiskFolders } = useNavigation();
  const [width, setWidth] = useState(loadWidth);
  /** The selected location's saved views, listed under it. */
  const locationViews = useOptionalLocationViews();
  /** Its views are folded away; selecting a location shows its views again. */
  const [viewsFolded, setViewsFolded] = useState(false);
  /** How many views each location has (the selected one's come live from its views). */
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
  useEffect(() => setViewsFolded(false), [activeLocationId]);
  /** The view whose name is being edited in place. */
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [deletingView, setDeletingView] = useState<StoredView | null>(null);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let latest = startWidth;
    function onMove(ev: MouseEvent) {
      latest = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + ev.clientX - startX));
      setWidth(latest);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      localStorage.setItem(WIDTH_KEY, String(latest));
    }
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  // The sidebar floats over the content; content panes start past it via this inset
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-inset", `${width + PANEL_MARGIN}px`);
  }, [width]);

  const [locations, setLocations] = useState<Location[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** The location whose Added Files folder is being chosen. */
  const [addedFolderFor, setAddedFolderFor] = useState<Location | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** The location whose name is being edited in place. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** Locations being indexed (a refresh, or a newly added location). */
  const [refreshing, setRefreshing] = useState<Set<string>>(() => new Set());
  const [refreshError, setRefreshError] = useState<{ id: string; message: string; action?: string } | null>(null);

  function setRefreshingFor(id: string, on: boolean) {
    setRefreshing((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Indexing reports progress for any location, however it was started
  useEffect(() => {
    const unlisten = listen<{ location_id: string; done: boolean; error?: string | null }>("indexing_progress", (e) => {
      setRefreshingFor(e.payload.location_id, !e.payload.done);
      if (e.payload.done && e.payload.error) setRefreshError({ id: e.payload.location_id, message: e.payload.error });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  /**
   * Brings the location in line with the disk: adds new files, updates edited
   * ones, follows moved and renamed files (keeping their metadata) and removes
   * deleted ones, then re-applies the folder mapping.
   */
  async function refreshLocation(id: string) {
    if (refreshing.has(id)) return;
    setRefreshError(null);
    setRefreshingFor(id, true);
    try {
      await ingestDirectory(id);
    } catch (e) {
      setRefreshingFor(id, false);
      setRefreshError({ id, message: String(e) });
    }
  }

  function showLocationMenu(e: React.MouseEvent, loc: Location) {
    e.preventDefault();
    showContextMenu(
      [
        { type: "item", text: "Map Disk Folders…", action: () => openDiskFolders(loc.location_id) },
        { type: "item", text: "Added Files Folder…", action: () => setAddedFolderFor(loc) },
        { type: "item", text: "Refresh", enabled: !refreshing.has(loc.location_id), action: () => refreshLocation(loc.location_id) },
        { type: "separator" },
        { type: "item", text: "Rename", action: () => setRenamingId(loc.location_id) },
        { type: "item", text: "Remove Location…", action: () => setConfirmDeleteId(loc.location_id) },
      ],
      { event: e }
    );
  }

  function showViewMenu(e: React.MouseEvent, view: StoredView) {
    e.preventDefault();
    if (!locationViews) return;
    const edited = view.view_id === locationViews.active?.view_id && locationViews.edited;
    showContextMenu(
      [
        { type: "item", text: "Save Changes", enabled: edited, action: () => void locationViews.saveChanges() },
        { type: "item", text: "Revert Changes", enabled: edited, action: () => void locationViews.revert() },
        { type: "separator" },
        {
          type: "item",
          text: "Set as Default",
          enabled: !view.is_default,
          action: () =>
            locationViews
              .setDefault(view.view_id)
              .catch((e) => setRefreshError({ id: view.location_id, message: String(e), action: "set the default view" })),
        },
        { type: "item", text: "Rename", action: () => setRenamingViewId(view.view_id) },
        // The default can't go: another is made default first
        { type: "item", text: "Delete View…", enabled: !view.is_default, action: () => setDeletingView(view) },
      ],
      { event: e }
    );
  }

  function commitViewRename(view: StoredView, text: string) {
    setRenamingViewId(null);
    const name = text.trim();
    if (!name || name === view.name || !locationViews) return;
    locationViews
      .rename(view.view_id, name)
      .catch((e) => setRefreshError({ id: view.location_id, message: String(e), action: "rename the view" }));
  }

  async function commitRename(loc: Location, text: string) {
    setRenamingId(null);
    const name = text.trim();
    if (!name || name === loc.name) return;
    try {
      const renamed = await renameLocation(loc.location_id, name);
      setLocations((locs) => locs.map((l) => (l.location_id === renamed.location_id ? renamed : l)));
    } catch (e) {
      setRefreshError({ id: loc.location_id, message: String(e), action: "rename" });
    }
  }

  async function loadLocations() {
    try {
      const locs = await getLocations();
      setLocations(locs);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadLocations();
  }, []);

  // Counted again on leaving a location, whose views may have changed while it was open
  useEffect(() => {
    let stale = false;
    Promise.all(locations.map((l) => getLocationViews(l.location_id).then((vs) => [l.location_id, vs.length] as const)))
      .then((counts) => {
        if (!stale) setViewCounts(Object.fromEntries(counts));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [locations, activeLocationId]);

  const countOf = (locationId: string) =>
    locationId === activeLocationId && locationViews?.active?.location_id === locationId
      ? locationViews.views.length
      : (viewCounts[locationId] ?? 1);
  // Room for disclosure triangles only once some location has views besides its default
  const gutter = locations.some((l) => countOf(l.location_id) > 1) ? "pl-5" : "pl-2";

  useEffect(() => {
    function onLocationAdded() {
      loadLocations();
    }
    window.addEventListener("location-added", onLocationAdded);
    return () => window.removeEventListener("location-added", onLocationAdded);
  }, []);

  // Drag to reorder: the locations, and the selected location's views (its default among them)
  const locationDrag = useDragReorder(locations.length, (from, gap) => {
    const ids = moveColumnId(
      locations.map((l) => l.location_id),
      locations[from].location_id,
      gap
    );
    const byId = new Map(locations.map((l) => [l.location_id, l]));
    setLocations(ids.map((id) => byId.get(id)!));
    reorderLocations(ids).catch((e) => {
      setRefreshError({ id: locations[from].location_id, message: String(e), action: "reorder the locations" });
      void loadLocations();
    });
  });
  const allViews = locationViews?.views ?? [];
  const viewDrag = useDragReorder(allViews.length, (from, gap) => {
    if (!locationViews) return;
    const ids = moveColumnId(
      allViews.map((v) => v.view_id),
      allViews[from].view_id,
      gap
    );
    locationViews.reorder(ids).catch((e) => {
      setRefreshError({ id: allViews[from].location_id, message: String(e), action: "reorder the views" });
      void locationViews.reload();
    });
  });

  const removing = locations.find((l) => l.location_id === confirmDeleteId) ?? null;

  async function handleDeleteLocation(locationId: string) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteLocation(locationId);
      if (activeLocationId === locationId) setActiveLocation(null);
      setLocations((prev) => prev.filter((l) => l.location_id !== locationId));
      setConfirmDeleteId(null);
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  function cancelDelete() {
    setConfirmDeleteId(null);
    setDeleteError(null);
  }

  async function handleClearDatabase() {
    setClearing(true);
    try {
      await clearDatabase();
      setActiveLocation(null);
      setLocations([]);
    } catch {
      // ignore
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  return (
    // Finder (macOS 26): the sidebar is a rounded panel floating over the content,
    // inset from the window edges. Solid rather than blurred: a backdrop blur
    // re-renders on every repaint underneath it, and little shows through anyway.
    <div
      data-tauri-drag-region
      data-keys-to-browse
      style={{ width: width + PANEL_MARGIN, padding: `${PANEL_MARGIN}px 0 ${PANEL_MARGIN}px ${PANEL_MARGIN}px` }}
      className="absolute left-0 top-0 bottom-0 z-40 flex text-sm"
    >
      {/* Drag the right edge to resize */}
      <div
        onMouseDown={startResize}
        className="absolute -right-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize"
      />
      <div className="flex flex-col flex-1 min-w-0 bg-neutral-800 border border-neutral-700/50 shadow-lg rounded-[18px] overflow-hidden">
        {/* Title bar area: the window's traffic lights sit here (52px from the window top) */}
        <div data-tauri-drag-region className="h-[44px] shrink-0" />
        <div className="px-4 pt-1 pb-1">
          <p className="text-neutral-500 text-[11px] font-semibold">Locations</p>
        </div>

        <div className="flex flex-col gap-px px-2 flex-1 overflow-y-auto py-1">
          {locations.length === 0 && (
            <p className="text-neutral-500 text-xs px-2 py-1">No locations</p>
          )}
          {locations.map((loc, locIndex) => {
            const isActive = loc.location_id === activeLocationId;
            const views =
              isActive && locationViews?.active?.location_id === loc.location_id ? locationViews.views : null;
            // A location with only its default view has nothing to show under it
            const hasViews = countOf(loc.location_id) > 1;
            const viewsShown = hasViews && !!views && !viewsFolded;
            // With its views showing, the selected view is highlighted rather than the location
            const isSelected = isActive && !viewsShown;
            const isRefreshing = refreshing.has(loc.location_id);
            const error = refreshError?.id === loc.location_id ? refreshError : null;
            return (
              <div
                key={loc.location_id}
                ref={locationDrag.itemRef(locIndex)}
                className={`relative flex flex-col ${locationDrag.drag?.from === locIndex ? "opacity-50" : ""}`}
              >
                {locationDrag.lineAt(locIndex) && <DropLine edge="top" />}
                {locationDrag.lineAt(locIndex, true) && <DropLine edge="bottom" />}
                <div className="group relative flex items-center" onContextMenu={(e) => showLocationMenu(e, loc)}>
                  {renamingId === loc.location_id ? (
                    // A plain row while renaming: a text field can't sit inside a button
                    <div className={`flex items-center gap-2 w-full ${gutter} pr-2 h-7 rounded-md ${isSelected ? "bg-neutral-700" : ""}`}>
                      <SymbolIcon name="folder" size={17} className={isActive ? "text-blue-500" : "text-neutral-400"} />
                      <RenameField
                        initial={loc.name}
                        label="Location name"
                        onCommit={(text) => void commitRename(loc, text)}
                        onCancel={() => setRenamingId(null)}
                      />
                    </div>
                  ) : (
                    <button
                      // Clicking the selected location again folds its views away, or shows them
                      onClick={() => (isActive ? setViewsFolded(viewsShown) : setActiveLocation(loc.location_id))}
                      onMouseDown={(e) => locationDrag.onMouseDown(e, locIndex)}
                      className={`flex items-center gap-2 w-full text-left ${gutter} h-7 rounded-md pr-7 group-hover:pr-12 ${
                        isSelected ? "bg-neutral-700 text-blue-500" : "text-neutral-100"
                      }`}
                    >
                      <SymbolIcon name="folder" size={17} className={isActive ? "text-blue-500" : "text-neutral-400"} />
                      <span className="truncate text-body">{loc.name}</span>
                    </button>
                  )}
                  {/* Disclosure for the location's saved views */}
                  {hasViews && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isActive) setViewsFolded(viewsShown);
                        else setActiveLocation(loc.location_id);
                      }}
                      aria-label={viewsShown ? `Hide views of ${loc.name}` : `Show views of ${loc.name}`}
                      aria-expanded={viewsShown}
                      className="absolute left-0.5 w-4 h-5 flex items-center justify-center text-neutral-500 hover:text-neutral-300"
                    >
                      <SymbolIcon
                        name="chevron.right"
                        size={9}
                        fallback="›"
                        className={`transition-transform ${viewsShown ? "rotate-90" : ""}`}
                      />
                    </button>
                  )}
                  <div className={`absolute right-1 flex items-center ${renamingId === loc.location_id ? "hidden" : ""}`}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openDiskFolders(loc.location_id);
                      }}
                      title="Map Disk Folders…"
                      aria-label={`Map disk folders of ${loc.name}`}
                      className="w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 opacity-0 group-hover:opacity-100"
                    >
                      <SymbolIcon name="map" size={12} fallback="⌖" />
                    </button>
                    {/* Shown on hover, and kept (spinning) while the location is being indexed */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        refreshLocation(loc.location_id);
                      }}
                      disabled={isRefreshing}
                      title={isRefreshing ? "Refreshing…" : "Refresh"}
                      aria-label={isRefreshing ? `Refreshing ${loc.name}` : `Refresh ${loc.name}`}
                      className={`w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 ${
                        isRefreshing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <SymbolIcon
                        name="arrow.clockwise"
                        size={12}
                        fallback="↻"
                        className={isRefreshing ? "animate-spin" : ""}
                      />
                    </button>
                  </div>
                </div>
                {viewsShown &&
                  views.map((view, dragIndex) => {
                    const selected = view.view_id === locationViews?.active?.view_id;
                    const rowClass = `relative flex items-center gap-2 w-full text-left pl-[42px] pr-2 h-7 rounded-md ${
                      selected ? "bg-neutral-700 text-blue-500" : "text-neutral-100"
                    } ${viewDrag.drag?.from === dragIndex ? "opacity-50" : ""}`;
                    const icon = (
                      <SymbolIcon
                        name="rectangle.stack"
                        size={14}
                        fallback="▤"
                        className={selected ? "text-blue-500" : "text-neutral-400"}
                      />
                    );
                    return renamingViewId === view.view_id ? (
                      <div key={view.view_id} className={rowClass}>
                        {icon}
                        <RenameField
                          initial={view.name}
                          label="View name"
                          onCommit={(text) => commitViewRename(view, text)}
                          onCancel={() => setRenamingViewId(null)}
                        />
                      </div>
                    ) : (
                      <button
                        key={view.view_id}
                        ref={viewDrag.itemRef(dragIndex)}
                        onClick={() => void locationViews?.select(view.view_id)}
                        onMouseDown={(e) => viewDrag.onMouseDown(e, dragIndex)}
                        onContextMenu={(e) => showViewMenu(e, view)}
                        className={rowClass}
                      >
                        {viewDrag.lineAt(dragIndex) && <DropLine edge="top" />}
                        {viewDrag.lineAt(dragIndex, true) && <DropLine edge="bottom" />}
                        {icon}
                        <span className="truncate text-body">{view.name}</span>
                        {selected && locationViews?.edited && (
                          <span className="shrink-0 text-xs text-neutral-500">Edited</span>
                        )}
                        {/* Once renamed, the view the location opens with is marked */}
                        {view.is_default && view.name !== DEFAULT_VIEW_NAME && <DefaultBadge />}
                      </button>
                    );
                  })}
                {error && (
                  <p className="px-2 pb-1 text-[11px] text-red-500 truncate" title={error.message}>
                    Couldn't {error.action ?? "refresh"}: {error.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-2 py-2 border-t border-neutral-700/60 flex flex-col gap-1">
          <button
            onClick={() => setAddOpen(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700/40 rounded transition-colors"
          >
            <SymbolIcon name="plus" size={12} fallback={<span className="text-base leading-none">+</span>} />
            <span>Add Location…</span>
          </button>

          <button
            onClick={() => setConfirmClear(true)}
            className="w-full px-2 py-1.5 text-xs text-red-700/80 hover:text-red-500 hover:bg-red-900/20 rounded transition-colors text-left"
          >
            Clear All Data…
          </button>
        </div>
      </div>

      {addOpen && <AddLocationModal onClose={() => setAddOpen(false)} />}
      {confirmClear && (
        <Dialog
          title="Clear all data?"
          message="Every location and file record is removed from Folderbase, with all properties and their values, folder mappings and saved views. Rules are kept. Nothing on disk or in the cloud changes. This can't be undone."
          onCancel={() => {
            if (!clearing) setConfirmClear(false);
          }}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setConfirmClear(false)} disabled={clearing} autoFocus>
                Cancel
              </DialogButton>
              <DialogButton variant="destructive" onClick={handleClearDatabase} disabled={clearing}>
                {clearing ? "Clearing…" : "Clear All Data"}
              </DialogButton>
            </>
          }
        />
      )}
      {addedFolderFor && (
        <AddedFolderSheet
          location={addedFolderFor}
          onClose={() => {
            setAddedFolderFor(null);
            void loadLocations();
          }}
        />
      )}
      {deletingView && (
        <Dialog
          title={`Delete “${deletingView.name}”?`}
          message="The view is removed. Files and their values aren't changed."
          onCancel={() => setDeletingView(null)}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setDeletingView(null)}>Cancel</DialogButton>
              <DialogButton
                variant="destructive"
                onClick={() => {
                  const view = deletingView;
                  setDeletingView(null);
                  locationViews
                    ?.remove(view.view_id)
                    .catch((e) => setRefreshError({ id: view.location_id, message: String(e), action: "delete the view" }));
                }}
              >
                Delete
              </DialogButton>
            </>
          }
        />
      )}
      {removing && (
        <Dialog
          title={`Remove “${removing.name}” from Folderbase?`}
          message={
            <>
              Its files are removed from Folderbase, with any properties set on them and its folder mappings.
              Nothing on disk or in the cloud changes, and you can add the folder again later.
              {deleteError && <span className="block mt-2 text-red-500">Couldn't remove: {deleteError}</span>}
            </>
          }
          onCancel={cancelDelete}
          onSubmit={() => {
            if (!deleting) handleDeleteLocation(removing.location_id);
          }}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={cancelDelete}>Cancel</DialogButton>
              <DialogButton variant="default" disabled={deleting} autoFocus>
                Remove
              </DialogButton>
            </>
          }
        />
      )}
    </div>
  );
}

/** Where a dragged location or view will land, as in Finder's sidebar. */
function DropLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1 right-1 z-10 h-[2px] rounded-full bg-blue-500"
      style={{ [edge]: -1.5 }}
    />
  );
}
