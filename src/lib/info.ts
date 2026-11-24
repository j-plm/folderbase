import { formatBytes } from "./settingsText";
import { isEmptyValue } from "./fileValues";
import { EXTRACTED_LABELS, listValues, valueToText } from "./propertyTypes";
import { formatLongDate } from "./arrange";
import type { CellEdit } from "./commands";
import type { FileRecord, ValueType } from "../types";

// Get Info and the Inspector (spec ▸ Get Info): their windows run apart from
// the main window, which holds the location's undo history, the open view's
// folders and the selection. They talk over these events; the rest of this
// file is the summing up they show, kept pure so it's tested.

/** Info window → main: "I'm open, showing these files" (null: the Inspector, following the selection). */
export const INFO_HELLO = "info-hello";
/** Main → every window: the main window's page (re)loaded, so open Info windows say hello again. */
export const INFO_MAIN_READY = "info-main-ready";
/** Info window → main: it's closing. */
export const INFO_BYE = "info-bye";
/** Main → an Info window: what to show (sent on hello, and whenever files, folders or the selection change). */
export const INFO_STATE = "info-state";
/** Info window → main: write these values, as one undoable change. */
export const INFO_EDIT = "info-edit";
/** Info window → main: go to this folder of the open view. */
export const INFO_GO = "info-go";
/** Info window → main: Edit ▸ Undo / Redo, which take back changes in the main window's history. */
export const INFO_UNDO = "info-undo";

export interface InfoHello {
  label: string;
  /** The files an Info window shows; null for the Inspector. */
  paths: string[] | null;
}

export interface InfoFolder {
  path: string[];
  /** Each folder on the way, named as it shows ("Acme", "2024"). */
  labels: string[];
}

export interface InfoState {
  /** The files to show (the selection, for the Inspector). */
  paths: string[];
  /** The location open in the main window, whose view the folders are of. */
  locationId: string | null;
  /** The open view's name ("Default" for the location's own). */
  viewName: string | null;
  /** The folders each file (by path) shows in under the open view's Hierarchy. */
  folders: Record<string, InfoFolder[]>;
  /** Bumped by every change in the main window, so the Info window reads its files again. */
  revision: number;
}

export interface InfoEdit {
  locationId: string;
  label: string;
  edits: CellEdit[];
  /** The same cells as they were, for Undo. */
  before: CellEdit[];
}

export interface InfoGo {
  locationId: string;
  path: string[];
}

/** "Report.pdf Info", or "3 items" for several. */
export function infoTitle(files: Pick<FileRecord, "file_path">[]): string {
  if (files.length === 1) return files[0].file_path.split(/[\\/]/).pop() ?? "";
  return files.length === 0 ? "No Selection" : `${files.length.toLocaleString()} items`;
}

/** The total size of files, as Finder sums a selection up ("3 items, 12.4 MB"). */
export function selectionSummary(files: Pick<FileRecord, "file_size">[]): string {
  const total = files.reduce((sum, f) => sum + (f.file_size ?? 0), 0);
  return `${files.length.toLocaleString()} ${files.length === 1 ? "item" : "items"}, ${formatBytes(total)}`;
}

/** A size with its exact bytes, as Finder's Info window shows it: "12.4 MB (12,422,104 bytes)". */
export function sizeWithBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "--";
  if (bytes < 1000) return formatBytes(bytes);
  return `${formatBytes(bytes)} (${bytes.toLocaleString()} bytes)`;
}

/** The value several files share, or "mixed" where they differ. Empty values count as the same nothing. */
export type Shared = { kind: "same"; value: unknown } | { kind: "mixed" };

const normal = (value: unknown, type: ValueType): string => {
  if (isEmptyValue(value)) return "";
  if (type === "array") return JSON.stringify([...listValues(value)].sort());
  return JSON.stringify(value);
};

export function sharedValue(files: FileRecord[], read: (file: FileRecord) => unknown, type: ValueType): Shared {
  if (files.length === 0) return { kind: "same", value: null };
  const first = read(files[0]);
  const key = normal(first, type);
  for (const f of files.slice(1)) if (normal(read(f), type) !== key) return { kind: "mixed" };
  return { kind: "same", value: isEmptyValue(first) ? null : first };
}

/** How many of the files hold each value of a list property, in the order first met. */
export function valueCounts(files: FileRecord[], read: (file: FileRecord) => unknown): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of files) for (const v of new Set(listValues(read(f)))) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }));
}

const stored = (file: FileRecord, key: string): unknown => (file.metadata ?? {})[key] ?? null;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Sets one value on every file (null clears it), leaving out files that already have it. */
export function setEdits(files: FileRecord[], key: string, value: unknown): CellEdit[] {
  return files.filter((f) => !same(stored(f, key), value)).map((f) => ({ file_id: f.file_id, key, value }));
}

/**
 * A list value ticked or unticked in the Inspector: `added` go onto every file
 * that lacks them, `removed` come off every file that has them, and each
 * file's other values stay. A Select (`multiple` false) holds one value, so an
 * added value replaces it.
 */
export function listEdits(files: FileRecord[], key: string, added: string[], removed: string[], multiple: boolean): CellEdit[] {
  const edits: CellEdit[] = [];
  for (const f of files) {
    const before = listValues(stored(f, key));
    let after: string[];
    if (multiple) {
      after = before.filter((v) => !removed.includes(v));
      for (const v of added) if (!after.includes(v)) after.push(v);
    } else {
      after = added.length > 0 ? [added[added.length - 1]] : before.filter((v) => !removed.includes(v));
    }
    const value = multiple ? (after.length > 0 ? after : null) : (after[0] ?? null);
    if (!same(stored(f, key), value)) edits.push({ file_id: f.file_id, key, value });
  }
  return edits;
}

/** The cells `edits` change, as they are now (for Undo). */
export function editsBefore(edits: CellEdit[], files: FileRecord[]): CellEdit[] {
  const byId = new Map(files.map((f) => [f.file_id, f]));
  return edits.map((e) => {
    const file = byId.get(e.file_id);
    return { ...e, value: file ? stored(file, e.key) : null };
  });
}

/** Get Info on many files asks first, as Finder does ("Open 24 Info windows?"). */
export const ASK_ABOVE = 10;

/** One text when every file gives it, else "Mixed". */
export function sameText(texts: string[]): string {
  return texts.every((t) => t === texts[0]) ? (texts[0] ?? "") : "Mixed";
}

export interface InfoRow {
  label: string;
  text: string;
}

/** The media properties some of the files hold (EXIF and the like), each shared or "Mixed". */
export function mediaRows(files: Pick<FileRecord, "metadata">[]): InfoRow[] {
  return Object.keys(EXTRACTED_LABELS)
    .filter((k) => files.some((f) => (f.metadata ?? {})[k] != null))
    .map((k) => ({ label: EXTRACTED_LABELS[k], text: sameText(files.map((f) => valueToText((f.metadata ?? {})[k] ?? ""))) }));
}

/**
 * The Preview pane's Information (spec ▸ Preview Pane): Created and Modified,
 * then the media properties. Where comes between them for one file, as a link,
 * so the component puts it in.
 */
export function informationRows(files: Pick<FileRecord, "metadata" | "timestamp" | "modified_at">[]): InfoRow[] {
  if (files.length === 0) return [];
  return [
    { label: "Created", text: sameText(files.map((f) => formatLongDate(f.timestamp))) },
    { label: "Modified", text: sameText(files.map((f) => formatLongDate(f.modified_at ?? f.timestamp))) },
    ...mediaRows(files),
  ];
}

/** Rows shown before Show More, as Finder's preview pane cuts Information short. */
export const SHOW_MORE_AFTER = 4;

/** The rows to show, and whether there's a Show More / Show Less to offer. */
export function showMore<T>(rows: T[], expanded: boolean, after = SHOW_MORE_AFTER): { shown: T[]; toggle: boolean } {
  const toggle = rows.length > after;
  return { shown: toggle && !expanded ? rows.slice(0, after) : rows, toggle };
}
