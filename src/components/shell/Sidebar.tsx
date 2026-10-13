import { useEffect, useState } from "react";
import { useNavigation } from "../../contexts/NavigationContext";
import { getLocations, clearDatabase, deleteLocation } from "../../lib/commands";
import type { Location } from "../../lib/commands";
import MapLocationModal from "./MapLocationModal";

export default function Sidebar() {
  const { activeLocationId, setActiveLocation } = useNavigation();
  const [locations, setLocations] = useState<Location[]>([]);
  const [mapOpen, setMapOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    <div className="w-[220px] shrink-0 bg-neutral-800 border-r border-neutral-700/60 flex flex-col text-sm">
      <div className="px-3 pt-3 pb-1">
        <p className="text-neutral-500 text-xs uppercase tracking-wide font-medium">
          Locations
        </p>
      </div>

      <div className="flex flex-col gap-px px-2 flex-1 overflow-y-auto py-1">
        {locations.length === 0 && (
          <p className="text-neutral-600 text-xs px-2 py-1">No locations mapped</p>
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

          return (
            <div key={loc.location_id} className="group relative flex items-center">
              <button
                onClick={() => setActiveLocation(loc.location_id)}
                className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded transition-colors pr-7 ${
                  isActive
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50"
                }`}
              >
                <svg
                  className="shrink-0 w-3.5 h-3.5"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M2 4a1 1 0 011-1h3.586a1 1 0 01.707.293L8.414 4.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"
                    fill="currentColor"
                  />
                </svg>
                <span className="truncate text-xs">{loc.name}</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteId(loc.location_id);
                }}
                className="absolute right-1 opacity-0 group-hover:opacity-100 p-1 text-neutral-600 hover:text-red-400 transition-all text-sm leading-none"
                title="Remove location"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="px-2 py-2 border-t border-neutral-700/60 flex flex-col gap-1">
        <button
          onClick={() => setMapOpen(true)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700/40 rounded transition-colors"
        >
          <span className="text-base leading-none">+</span>
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

      {mapOpen && <MapLocationModal onClose={() => setMapOpen(false)} />}
    </div>
  );
}
