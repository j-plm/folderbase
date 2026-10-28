import { useLocationViews } from "../../contexts/LocationViewsContext";
import type { FileRecord } from "../../types";
import SidePanel from "../shared/SidePanel";
import HierarchyEditor from "./HierarchyEditor";

interface Props {
  locationId: string;
  files: FileRecord[];
  onClose: () => void;
}

/**
 * The active view's Hierarchy, opened with Edit Hierarchy in any view
 * mode. Changes go into the view as the Database view's do: the default view
 * saves them, a named view shows them as edits until saved or reverted.
 */
export default function HierarchyPanel({ locationId, files, onClose }: Props) {
  const { active, edited, definition, recordFolders } = useLocationViews();

  return (
    <SidePanel
      title="Hierarchy"
      subtitle={active ? `${active.name}${edited ? " — Edited" : ""}` : undefined}
      widthKey="folder-structure-list-width"
      defaultWidth={480}
      minWidth={420}
      onClose={onClose}
      closeOnOutsideClick
    >
      {definition ? (
        <HierarchyEditor
          key={locationId}
          locationId={locationId}
          files={files}
          definition={definition}
          onChange={(root) => recordFolders({ ...definition.folders, root })}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-neutral-500 text-sm">Loading…</div>
      )}
    </SidePanel>
  );
}
