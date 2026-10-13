import { useState } from "react";
import { pickDirectory, addLocation, ingestDirectory } from "../../lib/commands";
import { useNavigation } from "../../contexts/NavigationContext";

interface Props {
  onClose: () => void;
}

export default function MapLocationModal({ onClose }: Props) {
  const { setActiveLocation } = useNavigation();
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handlePick() {
    const dir = await pickDirectory();
    if (!dir) return;
    setRootPath(dir);
    const parts = dir.replace(/\\/g, "/").split("/");
    setName(parts[parts.length - 1] || "My Location");
  }

  async function handleConfirm() {
    if (!rootPath || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const location = await addLocation(rootPath, name.trim());
      onClose();
      setActiveLocation(location.location_id);
      // fire-and-forget background indexing
      ingestDirectory(location.location_id).catch(() => {});
      window.dispatchEvent(new CustomEvent("location-added"));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Map Location</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 transition-colors text-base leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={handlePick}
            className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-neutral-600 rounded-md text-sm text-left truncate transition-colors text-neutral-300"
          >
            {rootPath ?? "Choose a folder…"}
          </button>

          {rootPath && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-neutral-400">Location name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-100 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="My Location"
              />
            </div>
          )}

          <button
            onClick={handleConfirm}
            disabled={!rootPath || busy || !name.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors"
          >
            {busy ? "Mapping…" : "Map Location"}
          </button>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
