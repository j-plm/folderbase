import { kindCategory } from "./arrange";
import type { ColumnKind } from "./dbTable";
import type { FileRecord, ValueType } from "../types";

// How the database view reads a file's columns: shared with rules, so a rule's
// conditions see exactly what the table and its filters see.

/** Custom property columns are "prop:<name>"; native ones use their own ids (name, ext, path…). */
export const PROP_PREFIX = "prop:";
export const propName = (columnId: string) => columnId.slice(PROP_PREFIX.length);

export function fileName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

export function fileExtension(filePath: string): string {
  const name = fileName(filePath);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** A file's name without its extension ("250301_Ruben" for "250301_Ruben.pdf"). */
export function baseName(filePath: string): string {
  const name = fileName(filePath);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export const NATIVE_KINDS: Record<string, ColumnKind> = {
  name: "text",
  ext: "list",
  path: "text",
  type: "list",
  size: "number",
  created: "date",
  modified: "date",
  tags: "list",
};

export const KIND_BY_TYPE: Record<ValueType, ColumnKind> = {
  free_text: "text",
  number: "number",
  date: "date",
  enum: "list",
  array: "list",
};

/** A native column's value for filtering. */
export function nativeValue(file: FileRecord, key: string): unknown {
  switch (key) {
    case "name":
      return fileName(file.file_path);
    case "ext":
      return fileExtension(file.file_path);
    case "path":
      return file.relative_path ?? file.file_path;
    case "type":
      return kindCategory(file);
    case "size":
      return file.file_size;
    case "created":
      return file.timestamp;
    case "modified":
      return file.modified_at;
    case "tags":
      return Array.isArray(file.tags) ? file.tags : [];
    default:
      return null;
  }
}

export function metaValue(file: FileRecord | undefined, key: string): unknown {
  return (file?.metadata as Record<string, unknown> | null | undefined)?.[key] ?? null;
}
