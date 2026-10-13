import { useState } from "react";
import { pickDirectory, addLocation, ingestDirectory, createView } from "../../lib/commands";
import { useNavigation } from "../../contexts/NavigationContext";

interface Props {
  onClose: () => void;
}

type Status = "idle" | "importing" | "done" | "error";

export default function ImportFolderModal({ onClose }: Props) {
  const { refreshViews, setActiveView } = useNavigation();
  const [folder, setFolder] = useState<string | null>(null);
  const [library, setLibrary] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function handlePick() {
    const dir = await pickDirectory();
    if (!dir) return;
    setFolder(dir);
    const parts = dir.replace(/\\/g, "/").split("/");
    setLibrary(parts[parts.length - 1] || "My Library");
  }

  async function handleImport() {
    if (!folder || !library.trim()) return;
    setStatus("importing");
    setError("");
    try {
      const libName = library.trim();
      const location = await addLocation(folder, libName);
      const view = await createView(libName, libName);
      await refreshViews();
      setActiveView(view.view_id);
      ingestDirectory(location.location_id).catch(() => {});
      window.dispatchEvent(new CustomEvent("location-added"));
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Import Folder</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 transition-colors text-base leading-none"
          >
            ✕
          </button>
        </div>

        {status === "done" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-green-400">
              Mapped <span className="font-medium text-green-300">{library}</span> and started indexing.
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-sm font-medium transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              onClick={handlePick}
              className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-neutral-600 rounded-md text-sm text-left truncate transition-colors text-neutral-300"
            >
              {folder ?? "Choose a folder…"}
            </button>

            {folder && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-neutral-400">Library name</label>
                  <input
                    value={library}
                    onChange={(e) => setLibrary(e.target.value)}
                    className="px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-100 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="My Library"
                  />
                </div>

                <button
                  onClick={handleImport}
                  disabled={status === "importing" || !library.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors"
                >
                  {status === "importing" ? "Importing…" : "Import"}
                </button>
              </>
            )}

            {status === "error" && (
              <p className="text-xs text-red-400">{error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
