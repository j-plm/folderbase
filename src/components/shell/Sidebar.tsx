import { useEffect, useRef, useState } from "react";
import type React from "react";
import { useNavigation } from "../../contexts/NavigationContext";
import { listen } from "@tauri-apps/api/event";
import { getLocations, clearDatabase, deleteLocation, ingestDirectory, renameLocation } from "../../lib/commands";
import type { Location } from "../../lib/commands";
import AddLocationModal from "./AddLocationModal";
import Dialog, { DialogButton } from "../shared/Dialog";
import { SymbolIcon } from "../../lib/fileIcons";
import { showContextMenu } from "../../lib/nativeMenu";

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
  const { activeLocationId, setActiveLocation, openStructureMapping } = useNavigation();
  const [width, setWidth] = useState(loadWidth);

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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** The location whose name is being edited in place. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** Locations being indexed (a refresh, or a newly added location). */
  const [refreshing, setRefreshing] = useState<Set<string>>(() => new Set());
  const [refreshError, setRefreshError] = useState<{ id: string; message: string } | null>(null);

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
        { type: "item", text: "Map Structure…", action: () => openStructureMapping(loc.location_id) },
        { type: "item", text: "Refresh", enabled: !refreshing.has(loc.location_id), action: () => refreshLocation(loc.location_id) },
        { type: "separator" },
        { type: "item", text: "Rename", action: () => setRenamingId(loc.location_id) },
        { type: "item", text: "Remove Location…", action: () => setConfirmDeleteId(loc.location_id) },
      ],
      { event: e }
    );
  }

  async function commitRename(loc: Location, text: string) {
    setRenamingId(null);
    const name = text.trim();
    if (!name || name === loc.name) return;
    try {
      const renamed = await renameLocation(loc.location_id, name);
      setLocations((locs) =>
        locs.map((l) => (l.location_id === renamed.location_id ? renamed : l)).sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (e) {
      setRefreshError({ id: loc.location_id, message: String(e) });
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

  useEffect(() => {
    function onLocationAdded() {
      loadLocations();
    }
    window.addEventListener("location-added", onLocationAdded);
    return () => window.removeEventListener("location-added", onLocationAdded);
  }, []);

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
          {locations.map((loc) => {
            const isActive = loc.location_id === activeLocationId;
            const isRefreshing = refreshing.has(loc.location_id);
            const error = refreshError?.id === loc.location_id ? refreshError.message : null;
            return (
              <div key={loc.location_id} className="flex flex-col">
                <div className="group relative flex items-center" onContextMenu={(e) => showLocationMenu(e, loc)}>
                  {renamingId === loc.location_id ? (
                    // A plain row while renaming: a text field can't sit inside a button
                    <div className={`flex items-center gap-2 w-full px-2 h-7 rounded-md ${isActive ? "bg-neutral-700" : ""}`}>
                      <SymbolIcon name="folder" size={17} className={isActive ? "text-blue-500" : "text-neutral-400"} />
                      <RenameField
                        initial={loc.name}
                        onCommit={(text) => void commitRename(loc, text)}
                        onCancel={() => setRenamingId(null)}
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => setActiveLocation(loc.location_id)}
                      className={`flex items-center gap-2 w-full text-left px-2 h-7 rounded-md pr-7 group-hover:pr-12 ${
                        isActive ? "bg-neutral-700 text-blue-500" : "text-neutral-100"
                      }`}
                    >
                      <SymbolIcon name="folder" size={17} className={isActive ? "text-blue-500" : "text-neutral-400"} />
                      <span className="truncate text-body">{loc.name}</span>
                    </button>
                  )}
                  <div className={`absolute right-1 flex items-center ${renamingId === loc.location_id ? "hidden" : ""}`}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openStructureMapping(loc.location_id);
                      }}
                      title="Map Structure…"
                      aria-label={`Map structure of ${loc.name}`}
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
                {error && (
                  <p className="px-2 pb-1 text-[11px] text-red-500 truncate" title={error}>
                    Couldn't refresh: {error}
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

/** A location's name edited in place, as in Finder: Return or clicking away renames, Escape cancels. */
function RenameField({ initial, onCommit, onCancel }: { initial: string; onCommit: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  function finish(commit: boolean) {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(text);
    else onCancel();
  }
  return (
    <input
      autoFocus
      value={text}
      aria-label="Location name"
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      // Clicks in the field edit it rather than selecting the location
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 h-5 px-1 -mx-1 rounded-[3px] bg-neutral-900 text-body text-neutral-100 outline outline-2 outline-blue-500"
    />
  );
}
