import type { DragItem } from "./filing";
import type { FileRecord } from "../types";

// What Icons, List and Columns hand to a drag (contexts/FileDragContext).

/** The folder at the top of a location that files dropped in from outside are copied into (as in commands/import.rs). */
export const HOLDING_FOLDER = "Added Files";

/** The groups Icons and List show when grouped by a property, as a hierarchy drops file into (FileDragContext `registerSource`). */
export const ARRANGED_GROUPS = "arranged-groups";

/** The icon dragged beside the pointer, in points, and how far right of and below it; the system's drag image matches it. */
export const DRAG_ICON_SIZE = 32;
export const DRAG_ICON_OFFSET = 8;

/**
 * The items a drag carries, by the ids shown (files and `folder:` ids): each
 * file from the folder it's shown in, each folder as its own path. Ids not
 * shown are left out.
 */
export function dragItemsFor(
  ids: string[],
  files: FileRecord[],
  /** The folder showing them. */
  from: string[],
  /** A folder's path by its id (null: not a folder). */
  folderPath: (id: string) => string[] | null
): DragItem[] {
  const byId = new Map(files.map((f) => [f.file_id, f]));
  return ids.flatMap((id): DragItem[] => {
    const path = folderPath(id);
    if (path) return [{ kind: "folder", path }];
    const file = byId.get(id);
    return file ? [{ kind: "file", file, from }] : [];
  });
}
