import { useState } from "react";
import { pickDirectory, addLocation, ingestDirectory } from "../../lib/commands";
import { useNavigation } from "../../contexts/NavigationContext";
import Dialog, { DialogButton, DialogField, dialogTextField } from "../shared/Dialog";
import { FolderIcon, SymbolIcon } from "../../lib/fileIcons";

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
    if (!rootPath || !name.trim() || busy) return;
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

  const folderName = rootPath?.replace(/\\/g, "/").split("/").filter(Boolean).pop();

  return (
    <Dialog
      title="Map Location"
      message="Choose a folder to add to Folderbase. Its files are indexed where they are; nothing on disk is moved."
      onCancel={onClose}
      onSubmit={handleConfirm}
      footer={
        <>
          <div className="flex-1" />
          <DialogButton onClick={onClose}>Cancel</DialogButton>
          <DialogButton variant="default" disabled={!rootPath || busy || !name.trim()}>
            {busy ? "Mapping…" : "Map Location"}
          </DialogButton>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <DialogField label="Folder:">
          {/* Styled as a native pop-up button, like the "Where:" control in save sheets */}
          <button
            type="button"
            onClick={handlePick}
            title={rootPath ?? undefined}
            className="w-full h-6 flex items-center gap-1.5 pl-1.5 pr-2 rounded-[6px] bg-neutral-800 dark:bg-neutral-700 text-left"
          >
            {rootPath && <FolderIcon size={16} />}
            <span className={`flex-1 truncate ${rootPath ? "" : "text-neutral-500"}`}>
              {folderName ?? "Choose…"}
            </span>
            <SymbolIcon name="chevron.up.chevron.down" size={11} fallback="⌃" className="text-neutral-400" />
          </button>
        </DialogField>
        <DialogField label="Name:">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!rootPath}
            className={`${dialogTextField} disabled:opacity-50`}
          />
        </DialogField>
        {error && <p className="pl-[80px] text-xs text-red-500">{error}</p>}
      </div>
    </Dialog>
  );
}
