import { KIND_CATEGORIES, dateGroup, kindCategory, nameGroup, sizeGroup } from "./arrange";
import type { ColumnKind } from "./dbTable";
import type { GroupKey } from "./dbGroups";
import { KIND_BY_TYPE, NATIVE_KINDS, PROP_PREFIX, metaValue, nativeValue, propName } from "./fileColumns";
import { dateKey, dateTimeKey, listValues, valueToText } from "./propertyTypes";
import { applies, impliedValues, type Scope } from "./scopes";
import type { FileRecord, ValueType } from "../types";

// How a view reads its files' values: shared by the Database view (filters,
// sorting, grouping) and the hierarchy, so both see the same files.

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const isEmptyValue = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

const NO_IMPLIED: Record<string, string[]> = {};

/**
 * Values files hold only by implication (Housing = Rent implies Tags has
 * `housing`), by file id: counted by filters, sorting and grouping, but never
 * written back as stored values.
 */
export function impliedByFile(
  files: FileRecord[],
  scopes: Scope[],
  isList: (property: string) => boolean
): Map<string, Record<string, string[]>> {
  const map = new Map<string, Record<string, string[]>>();
  if (scopes.length === 0) return map;
  for (const f of files) {
    const implied = impliedValues(f.metadata as Record<string, unknown> | null, scopes, isList);
    if (Object.keys(implied).length > 0) map.set(f.file_id, implied);
  }
  return map;
}

export interface ValueSource {
  typeOf: (name: string) => ValueType;
  scopes: Scope[];
  /** From `impliedByFile`. */
  implied: Map<string, Record<string, string[]>>;
}

export interface ValueReader {
  impliedFor: (fileId: string) => Record<string, string[]>;
  scopeOf: (name: string) => Scope | undefined;
  /** A property's value with any implied values added. */
  effectiveValue: (file: FileRecord | undefined, name: string) => unknown;
  columnValue: (file: FileRecord, columnId: string) => unknown;
  kindOf: (columnId: string) => ColumnKind;
  sortValue: (file: FileRecord, columnId: string) => string | number | null | undefined;
  /** Which group a file falls in for a column: Finder's buckets for its own columns, the value for properties. */
  groupKey: (file: FileRecord, columnId: string) => GroupKey | null;
  /** Whether a scoped property applies to the file (a property without a scope always does). */
  appliesTo: (file: FileRecord, name: string) => boolean;
}

export function valueReader({ typeOf, scopes, implied }: ValueSource): ValueReader {
  const impliedFor = (fileId: string) => implied.get(fileId) ?? NO_IMPLIED;
  const scopeOf = (name: string) => scopes.find((s) => s.property === name);

  const effectiveValue = (file: FileRecord | undefined, name: string): unknown => {
    const value = metaValue(file, name);
    const extra = file ? implied.get(file.file_id)?.[name] : undefined;
    if (!extra) return value;
    const stored = listValues(value);
    return typeOf(name) === "array" || stored.length + extra.length > 1 ? [...stored, ...extra] : extra[0];
  };

  const columnValue = (file: FileRecord, columnId: string): unknown =>
    columnId.startsWith(PROP_PREFIX) ? effectiveValue(file, propName(columnId)) : nativeValue(file, columnId);

  const kindOf = (columnId: string): ColumnKind =>
    columnId.startsWith(PROP_PREFIX) ? KIND_BY_TYPE[typeOf(propName(columnId))] : NATIVE_KINDS[columnId] ?? "text";

  const sortValue = (file: FileRecord, columnId: string): string | number | null | undefined => {
    if (!columnId.startsWith(PROP_PREFIX)) {
      const v = nativeValue(file, columnId);
      return Array.isArray(v) ? v.join(", ") : (v as string | number | null);
    }
    const name = propName(columnId);
    const v = effectiveValue(file, name);
    if (v == null) return null;
    const type = typeOf(name);
    if (type === "number" && typeof v === "number") return v;
    if (type === "date") return dateTimeKey(v) ?? valueToText(v);
    return valueToText(v);
  };

  const appliesTo = (file: FileRecord, name: string) =>
    applies(scopeOf(name), file.metadata as Record<string, unknown> | null, impliedFor(file.file_id));

  const groupKey = (file: FileRecord, columnId: string): GroupKey | null => {
    const bucket = ([label, rank]: [string, number]) => ({ label, rank });
    if (!columnId.startsWith(PROP_PREFIX)) {
      switch (columnId) {
        case "name":
          return bucket(nameGroup(file));
        case "type": {
          const category = kindCategory(file);
          return { label: category, rank: KIND_CATEGORIES.indexOf(category) };
        }
        case "size":
          if (file.file_size == null) return null;
          // Buckets run largest first; ranked so ascending is smallest first
          return { ...bucket(sizeGroup(file.file_size)), rank: -sizeGroup(file.file_size)[1] };
        case "created":
        case "modified": {
          const iso = columnId === "created" ? file.timestamp : file.modified_at ?? file.timestamp;
          if (!iso) return null;
          // Ranked so ascending is oldest first (Finder's buckets count back from today)
          const [label, rank] = dateGroup(iso, new Date());
          return { label, rank: -rank };
        }
        case "path": {
          const rel = (file.relative_path ?? "").replace(/\\/g, "/");
          const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
          return { label: folder || "Top Level", rank: folder };
        }
        default: {
          const v = nativeValue(file, columnId);
          const list = listValues(v);
          if (list.length === 0) return v == null || v === "" ? null : { label: String(v), rank: String(v) };
          const label = [...list].sort((a, b) => a.localeCompare(b)).join(", ");
          return { label, rank: label };
        }
      }
    }
    const name = propName(columnId);
    const v = effectiveValue(file, name);
    if (isEmptyValue(v)) {
      // A scoped property's files it doesn't apply to group apart from those still missing a value
      if (scopeOf(name) && !appliesTo(file, name)) return { label: "Doesn't Apply", rank: "￿" };
      return null;
    }
    const type = typeOf(name);
    if (type === "number" && typeof v === "number") return { label: valueToText(v), rank: v };
    if (type === "date") {
      const key = dateKey(v);
      if (!key) return { label: valueToText(v), rank: valueToText(v) };
      const [year, month] = key.split("-");
      return { label: `${MONTH_NAMES[Number(month) - 1]} ${year}`, rank: `${year}-${month}` };
    }
    if (type === "array") {
      // A file with several values is grouped under that combination
      const label = [...listValues(v)].sort((a, b) => a.localeCompare(b)).join(", ");
      return { label, rank: label };
    }
    return { label: valueToText(v), rank: valueToText(v) };
  };

  return { impliedFor, scopeOf, effectiveValue, columnValue, kindOf, sortValue, groupKey, appliesTo };
}
