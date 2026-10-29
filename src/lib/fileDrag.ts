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

/** How near a scrolling area's edge a drag starts scrolling it, and the fastest it goes (points per frame). */
export const SCROLL_EDGE = 28;
export const SCROLL_MAX = 18;

/**
 * How far a drag at (x, y) scrolls an area within `rect` this frame: faster
 * the nearer the edge, as Finder scrolls a list dragged near its top or
 * bottom (or a row of columns near its side). Nothing outside the area.
 */
export function edgeScroll(
  rect: { left: number; top: number; right: number; bottom: number },
  x: number,
  y: number,
  edge = SCROLL_EDGE,
  max = SCROLL_MAX
): { dx: number; dy: number } {
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return { dx: 0, dy: 0 };
  const speed = (into: number) => (into < edge ? Math.ceil(((edge - into) / edge) * max) : 0);
  // Both edges at once in a tiny area: no scrolling
  const along = (from: number, to: number, at: number) => (to - from < edge * 2 ? 0 : speed(to - at) - speed(at - from));
  return { dx: along(rect.left, rect.right, x), dy: along(rect.top, rect.bottom, y) };
}
