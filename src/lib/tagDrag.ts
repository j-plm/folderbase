import { listValues } from "./propertyTypes";

// Dragging a tag pill onto a list column in the database view. A path tag is
// a folder name (dropping it maps every folder with that name to the column);
// a property's value moves from its column into the other (see move_property_value).

/** How long a dragged tag must hover over a column before a release drops it there. */
export const DROP_DWELL_MS = 500;

/** Pointer travel before a press on a pill becomes a drag (a shorter one is a click). */
export const DRAG_THRESHOLD = 4;

/** How many distinct folders called `name` the files sit in (a path tag's folders). */
export function countFoldersNamed(relativePaths: (string | null | undefined)[], name: string): number {
  const found = new Set<string>();
  for (const rel of relativePaths) {
    if (!rel) continue;
    const parts = rel.replace(/\\/g, "/").split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] === name) found.add(parts.slice(0, i + 1).join("/"));
    }
  }
  return found.size;
}

/**
 * Every value a file holds in its properties. A path tag in this set is
 * "covered": already recorded in a property, so the pill shows faded.
 * Keys starting with "_" are internal and don't count.
 */
export function coveredValues(metadata: Record<string, unknown> | null | undefined): Set<string> {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (key.startsWith("_")) continue;
    for (const v of listValues(value)) values.add(v);
  }
  return values;
}

/** The column under a horizontal offset into the table's content, given columns in display order. */
export function columnAtOffset(offset: number, columns: { id: string; width: number }[]): string | null {
  if (offset < 0) return null;
  let left = 0;
  for (const col of columns) {
    if (offset < left + col.width) return col.id;
    left += col.width;
  }
  return null;
}

/** Where a column starts, as an offset into the table's content. */
export function columnOffset(id: string, columns: { id: string; width: number }[]): number {
  let left = 0;
  for (const col of columns) {
    if (col.id === id) return left;
    left += col.width;
  }
  return left;
}
