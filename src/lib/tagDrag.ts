import { listValues } from "./propertyTypes";

// Dragging a tag pill onto a list column in the database view. A source tag is
// a folder name (dropping it maps every folder with that name to the column);
// a hand-added tag moves from the Tags property into the column.

/** How long a dragged tag must hover over a column before a release drops it there. */
export const DROP_DWELL_MS = 500;

/** Pointer travel before a press on a pill becomes a drag (a shorter one is a click). */
export const DRAG_THRESHOLD = 4;

/** How many distinct folders called `name` the files sit in (a source tag's folders). */
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
 * Every value a file holds in its properties. A source tag in this set is
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

/**
 * A cell's value with `value` added: appended to a Multi-select (once), or
 * replacing a Select's value.
 */
export function withListValue(current: unknown, value: string, multiple: boolean): unknown {
  if (!multiple) return value;
  const items = listValues(current);
  return items.includes(value) ? items : [...items, value];
}

/** A Multi-select cell's value without `value`; null when nothing is left. */
export function withoutListValue(current: unknown, value: string): string[] | null {
  const rest = listValues(current).filter((v) => v !== value);
  return rest.length > 0 ? rest : null;
}
