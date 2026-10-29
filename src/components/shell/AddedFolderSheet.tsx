import { useEffect, useMemo, useState } from "react";
import { getFilesForLocation, pickDirectory, setAddedFolder, type Location } from "../../lib/commands";
import { HOLDING_FOLDER } from "../../lib/fileDrag";
import Dialog, { DialogButton, DialogField, dialogTextField } from "../shared/Dialog";

/**
 * A location's Added Files folder: where files dropped in from other apps are
 * copied. Chosen inside the location; the files already in the old one can
 * move there too (their values follow).
 */
export default function AddedFolderSheet({ location, onClose }: { location: Location; onClose: () => void }) {
  const current = location.added_folder ?? HOLDING_FOLDER;
  const [folder, setFolder] = useState(current);
  const [move, setMove] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Files in the current Added Files folder. */
  const [inside, setInside] = useState(0);

  useEffect(() => {
    let live = true;
    getFilesForLocation(location.location_id)
      .then((files) => {
        if (live) setInside(files.filter((f) => (f.relative_path ?? "").replace(/\\/g, "/").startsWith(`${current}/`)).length);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [location.location_id, current]);

  const root = location.root_path.replace(/[\\/]+$/, "");
  const changed = useMemo(() => folder.trim().replace(/^[\\/]+|[\\/]+$/g, "") !== current, [folder, current]);

  async function choose() {
    const dir = await pickDirectory(root);
    if (!dir) return;
    const normal = dir.replace(/[\\/]+$/, "");
    if (normal === root || !(normal.startsWith(`${root}/`) || normal.startsWith(`${root}\\`))) {
      setError(`Choose a folder inside “${location.name}”.`);
      return;
    }
    setError("");
    setFolder(normal.slice(root.length + 1).replace(/\\/g, "/"));
  }

  async function save() {
    if (!changed || busy) return;
    setBusy(true);
    setError("");
    try {
      await setAddedFolder(location.location_id, folder, move && inside > 0);
      window.dispatchEvent(new CustomEvent("location-changed"));
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Added Files Folder"
      message={`Files dropped in from other apps are copied into this folder inside “${location.name}”, then given the values of the folder they were dropped on. It's made when the first file arrives.`}
      onCancel={onClose}
      onSubmit={save}
      footer={
        <>
          <div className="flex-1" />
          <DialogButton onClick={onClose}>Cancel</DialogButton>
          <DialogButton variant="default" disabled={!changed || busy || !folder.trim()}>
            {busy ? "Changing…" : "Change"}
          </DialogButton>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <DialogField label="Folder:">
          <div className="flex gap-2">
            <input value={folder} onChange={(e) => setFolder(e.target.value)} autoFocus className={dialogTextField} />
            <DialogButton onClick={() => void choose()}>Choose…</DialogButton>
          </div>
        </DialogField>
        {inside > 0 && changed && (
          <label className="flex items-center gap-2 pl-[80px]">
            <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} />
            <span>
              Move the {inside.toLocaleString()} {inside === 1 ? "file" : "files"} in “{current}” there too
            </span>
          </label>
        )}
        {error && <p className="pl-[80px] text-xs text-red-500">{error}</p>}
      </div>
    </Dialog>
  );
}
