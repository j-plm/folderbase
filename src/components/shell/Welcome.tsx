import { useState } from "react";
import { pickDirectory, ingestDirectory } from "../../lib/commands";

interface Props {
  onComplete: () => void;
}

type Status = "idle" | "importing" | "done" | "error";

export default function Welcome({ onComplete }: Props) {
  const [folder, setFolder] = useState<string | null>(null);
  const [library, setLibrary] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [count, setCount] = useState(0);
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
      const imported = await ingestDirectory(folder, library.trim());
      setCount(imported);
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-gray-100">
      <div className="w-full max-w-sm flex flex-col gap-6 px-4">
        <div>
          <h1 className="text-2xl font-semibold mb-2">Welcome to Folderbase</h1>
          <p className="text-sm text-gray-400 leading-relaxed">
            Folderbase organises your files virtually — nothing on disk is moved
            or changed.
          </p>
        </div>

        {status === "done" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-green-400">
              Imported {count} file{count !== 1 ? "s" : ""} into{" "}
              <span className="font-medium text-green-300">{library}</span>.
            </p>
            <button
              onClick={onComplete}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-sm font-medium transition-colors"
            >
              Open Folderbase
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              onClick={handlePick}
              className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-md text-sm text-left truncate transition-colors"
            >
              {folder ?? "Choose a folder to import…"}
            </button>

            {folder && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-400">Library name</label>
                  <input
                    value={library}
                    onChange={(e) => setLibrary(e.target.value)}
                    className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm focus:outline-none focus:border-blue-500 transition-colors"
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
