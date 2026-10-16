import { useEffect, useState } from "react";
import type React from "react";
import { useNavigation } from "../../contexts/NavigationContext";
import { listen } from "@tauri-apps/api/event";
import { getLocations, clearDatabase, deleteLocation, ingestDirectory } from "../../lib/commands";
import type { Location } from "../../lib/commands";
import MapLocationModal from "./MapLocationModal";
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
  const { activeLocationId, setActiveLocation } = useNavigation();
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
  const [mapOpen, setMapOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Locations being indexed (a refresh, or a newly mapped location). */
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
        { type: "item", text: "Refresh", enabled: !refreshing.has(loc.location_id), action: () => refreshLocation(loc.location_id) },
        { type: "separator" },
        { type: "item", text: "Remove from Folderbase…", action: () => setConfirmDeleteId(loc.location_id) },
      ],
      { event: e }
    );
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

  async function handleDeleteLocation(locationId: string) {
    setDeleting(true);
    try {
      await deleteLocation(locationId);
      if (activeLocationId === locationId) setActiveLocation(null);
      setLocations((prev) => prev.filter((l) => l.location_id !== locationId));
    } catch {
      // ignore
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
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
            <p className="text-neutral-500 text-xs px-2 py-1">No locations mapped</p>
          )}
          {locations.map((loc) => {
            const isActive = loc.location_id === activeLocationId;
            const isConfirming = confirmDeleteId === loc.location_id;

            if (isConfirming) {
              return (
                <div
                  key={loc.location_id}
                  className="flex flex-col gap-1 px-2 py-1.5 rounded bg-neutral-900/60 border border-red-900/30"
                >
                  <p className="text-xs text-neutral-400 truncate">
                    Remove "{loc.name}"?
                  </p>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleDeleteLocation(loc.location_id)}
                      disabled={deleting}
                      className="flex-1 px-2 py-0.5 text-xs rounded bg-red-800/60 text-red-200 hover:bg-red-700/60 disabled:opacity-50 transition-colors"
                    >
                      {deleting ? "…" : "Remove"}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="flex-1 px-2 py-0.5 text-xs rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            const isRefreshing = refreshing.has(loc.location_id);
            const error = refreshError?.id === loc.location_id ? refreshError.message : null;
            return (
              <div key={loc.location_id} className="flex flex-col">
                <div className="group relative flex items-center" onContextMenu={(e) => showLocationMenu(e, loc)}>
                  <button
                    onClick={() => setActiveLocation(loc.location_id)}
                    className={`flex items-center gap-2 w-full text-left px-2 h-7 rounded-md pr-12 ${
                      isActive ? "bg-neutral-700 text-blue-500" : "text-neutral-100"
                    }`}
                  >
                    <SymbolIcon name="folder" size={17} className={isActive ? "text-blue-500" : "text-neutral-400"} />
                    <span className="truncate text-body">{loc.name}</span>
                  </button>
                  <div className="absolute right-1 flex items-center">
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(loc.location_id);
                      }}
                      className="w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400"
                      title="Remove location"
                      aria-label={`Remove ${loc.name}`}
                    >
                      <SymbolIcon name="xmark" size={10} fallback="×" />
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
            onClick={() => setMapOpen(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700/40 rounded transition-colors"
          >
            <SymbolIcon name="plus" size={12} fallback={<span className="text-base leading-none">+</span>} />
            <span>Map Location</span>
          </button>

          {!confirmClear ? (
            <button
              onClick={() => setConfirmClear(true)}
              className="w-full px-2 py-1.5 text-xs text-red-700/80 hover:text-red-500 hover:bg-red-900/20 rounded transition-colors text-left"
            >
              Clear All Data
            </button>
          ) : (
            <div className="flex flex-col gap-1.5 px-2 py-2 rounded bg-neutral-900/60 border border-red-900/40">
              <p className="text-xs text-neutral-400 leading-snug">
                This will permanently delete all locations and file records. This cannot be undone.
              </p>
              <div className="flex gap-1.5">
                <button
                  onClick={handleClearDatabase}
                  disabled={clearing}
                  className="flex-1 px-2 py-1 text-xs rounded bg-red-800/60 text-red-200 hover:bg-red-700/60 disabled:opacity-50 transition-colors"
                >
                  {clearing ? "Clearing…" : "Clear Everything"}
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="flex-1 px-2 py-1 text-xs rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {mapOpen && <MapLocationModal onClose={() => setMapOpen(false)} />}
    </div>
  );
}
