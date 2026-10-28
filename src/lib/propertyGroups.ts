import { PROP_PREFIX, propName } from "./fileColumns";
import { EXTRACTED_KEYS } from "./propertyTypes";

// Wherever properties are listed to choose from (filters, sorts, groups,
// rules, column menus, the hierarchy), they're collected into the same
// groups, in the same order: the library's own, the file's, then the media's.

export type PropertyGroup = "custom" | "native" | "media";

export const PROPERTY_GROUPS: { group: PropertyGroup; label: string }[] = [
  { group: "custom", label: "Custom" },
  { group: "native", label: "Native" },
  { group: "media", label: "Media" },
];

/**
 * A column's group: a property of the library's ("prop:Client"), one read
 * from the file's media (EXIF: camera, ISO, size in pixels…), or the file's
 * own (Name, Kind, Size, Created, Path Tags…). Accepts a bare property name too.
 */
export function columnGroup(column: string, bareName = false): PropertyGroup {
  const isProperty = bareName || column.startsWith(PROP_PREFIX);
  if (!isProperty) return "native";
  return EXTRACTED_KEYS.has(bareName ? column : propName(column)) ? "media" : "custom";
}

/** Items in their groups, custom then native then media, each keeping its order; empty groups left out. */
export function groupByColumn<T>(
  items: T[],
  columnOf: (item: T) => string,
  bareName = false
): { group: PropertyGroup; label: string; items: T[] }[] {
  return PROPERTY_GROUPS.map(({ group, label }) => ({
    group,
    label,
    items: items.filter((item) => columnGroup(columnOf(item), bareName) === group),
  })).filter((g) => g.items.length > 0);
}
