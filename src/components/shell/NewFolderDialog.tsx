import { useState } from "react";
import { useBrowse } from "../../contexts/BrowseContext";
import Dialog, { DialogButton, DialogField, dialogTextField } from "../shared/Dialog";

/**
 * New Folder where you are (⇧⌘N): a folder of the level's property, shown
 * only in this folder. A name the property doesn't have yet becomes a new
 * value; one it has is just shown here, though no file has it yet.
 */
export default function NewFolderDialog() {
  const browse = useBrowse();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!browse?.newFolderOpen || !browse.newFolderHere) return null;
  const { newFolderHere, steps, makeFolder, setNewFolderOpen } = browse;
  const here = steps[steps.length - 1]?.label;
  const close = () => {
    setNewFolderOpen(false);
    setText("");
    setError(null);
  };

  async function submit() {
    try {
      await makeFolder(text);
      close();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <Dialog
      title={here ? `New Folder in “${here}”` : "New Folder"}
      message={`A folder of ${newFolderHere.label}, here only. A name ${newFolderHere.label} doesn't have yet becomes a new value; files go in it once they're given that value.`}
      onCancel={close}
      onSubmit={() => void submit()}
      footer={
        <>
          <span className="flex-1" />
          <DialogButton onClick={close}>Cancel</DialogButton>
          <DialogButton variant="default" disabled={!text.trim()}>
            Create
          </DialogButton>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <DialogField label="Name:">
          <input
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            list="new-folder-values"
            spellCheck={false}
            className={dialogTextField}
          />
        </DialogField>
        {/* The property's values not yet a folder here */}
        <datalist id="new-folder-values">
          {newFolderHere.candidates.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        {error && <p className="pl-[80px] text-xs text-red-500">{error}</p>}
      </div>
    </Dialog>
  );
}
