// Finder-style sorting and grouping for the Tiles, List and Columns views.

import type { FileRecord } from "../types";
import { compareSortValues, type SortDirection } from "./columns";
import { fileExtension } from "./fileIcons";

export type SortKey = "name" | "kind" | "modified" | "created" | "size";
export type GroupBy = "none" | SortKey;

export interface Arrangement {
  sort: { key: SortKey; direction: SortDirection };
  groupBy: GroupBy;
}

export const DEFAULT_ARRANGEMENT: Arrangement = {
  sort: { key: "name", direction: "asc" },
  groupBy: "none",
};

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "kind", label: "Kind" },
  { key: "modified", label: "Date Modified" },
  { key: "created", label: "Date Created" },
  { key: "size", label: "Size" },
];

export const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "none", label: "None" },
  ...SORT_OPTIONS,
];

/** Finder sorts names A→Z but dates and sizes newest/largest first. */
export function defaultDirection(key: SortKey): SortDirection {
  return key === "name" || key === "kind" ? "asc" : "desc";
}

const DAY = 24 * 60 * 60 * 1000;

export function fileName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

// Finder's "Kind" text for common extensions.
const KIND_BY_EXT: Record<string, string> = {
  pdf: "PDF Document",
  doc: "Microsoft Word document",
  docx: "Microsoft Word document (.docx)",
  xls: "Microsoft Excel workbook",
  xlsx: "Microsoft Excel workbook (.xlsx)",
  xlsm: "Microsoft Excel macro-enabled workbook (.xlsm)",
  ppt: "Microsoft PowerPoint presentation",
  pptx: "Microsoft PowerPoint presentation (.pptx)",
  potx: "Microsoft PowerPoint template (.potx)",
  pages: "Pages document",
  numbers: "Numbers spreadsheet",
  key: "Keynote presentation",
  csv: "CSV document",
  txt: "Plain Text",
  md: "Markdown document",
  rtf: "RTF document",
  html: "HTML text",
  htm: "HTML text",
  json: "JSON",
  zip: "ZIP archive",
  jpg: "JPEG image",
  jpeg: "JPEG image",
  png: "PNG image",
  gif: "GIF image",
  heic: "HEIF image",
  tif: "TIFF image",
  tiff: "TIFF image",
  svg: "SVG document",
  mp4: "MPEG-4 movie",
  mov: "QuickTime movie",
  mp3: "MP3 audio",
  m4a: "Apple MPEG-4 audio",
  wav: "Waveform audio",
};

/** Finder's "Kind" column text. */
export function kindLabel(file: Pick<FileRecord, "file_path" | "file_type">): string {
  const ext = fileExtension(file.file_path);
  if (KIND_BY_EXT[ext]) return KIND_BY_EXT[ext];
  const mime = file.file_type ?? "";
  const sub = (mime.split("/")[1] ?? "").replace(/^x-/, "").toUpperCase();
  if (mime.startsWith("image/")) return `${sub} image`;
  if (mime.startsWith("video/")) return `${sub} movie`;
  if (mime.startsWith("audio/")) return `${sub} audio`;
  if (mime.startsWith("text/")) return ext ? `${ext.toUpperCase()} text` : "Plain Text";
  return ext ? `${ext.toUpperCase()} file` : "Document";
}

/** Finder list date: "Today at 05:58", "Yesterday at 22:06", "13 Aug 2026 at 13:07". */
export function formatFinderDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return `Today at ${time}`;
  if (date.getTime() >= startOfToday - DAY) return `Yesterday at ${time}`;
  const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `${day} at ${time}`;
}

/** Finder's long date (Get Info / preview): "Monday, 18 May 2026 at 10:06". */
export function formatLongDate(iso: string | null | undefined): string {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  const day = date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} at ${time}`;
}

/** Finder sizes: decimal units, whole KB, one decimal for MB and up ("5 KB", "1.7 MB"). */
export function formatFinderSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "--";
  if (bytes < 1000) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  if (bytes < 1000 ** 2) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1000 ** 3) return `${(bytes / 1000 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1000 ** 3).toFixed(1)} GB`;
}

// ── Kind categories (Finder's "Group By ▸ Kind") ───────────────────────────

export const KIND_CATEGORIES = [
  "Documents",
  "Images",
  "PDF Documents",
  "Movies",
  "Music",
  "Presentations",
  "Spreadsheets",
  "Developer",
  "Other",
] as const;
export type KindCategory = (typeof KIND_CATEGORIES)[number];

const PRESENTATION_EXTS = new Set(["ppt", "pptx", "key", "odp"]);
const SPREADSHEET_EXTS = new Set(["xls", "xlsx", "xlsm", "csv", "tsv", "numbers", "ods"]);
const DOCUMENT_EXTS = new Set(["doc", "docx", "pages", "rtf", "txt", "md", "markdown", "odt", "epub"]);
const DEVELOPER_EXTS = new Set([
  "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "java", "kt", "swift", "c", "h",
  "cpp", "hpp", "cs", "php", "sh", "zsh", "bash", "json", "toml", "yaml", "yml", "xml", "html",
  "css", "scss", "sql", "lock", "ipynb", "vue", "svelte",
]);

export function kindCategory(file: Pick<FileRecord, "file_path" | "file_type">): KindCategory {
  const ext = fileExtension(file.file_path);
  const mime = file.file_type ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "PDF Documents";
  if (PRESENTATION_EXTS.has(ext)) return "Presentations";
  if (SPREADSHEET_EXTS.has(ext)) return "Spreadsheets";
  if (DEVELOPER_EXTS.has(ext)) return "Developer";
  if (mime.startsWith("image/")) return "Images";
  if (mime.startsWith("video/")) return "Movies";
  if (mime.startsWith("audio/")) return "Music";
  if (DOCUMENT_EXTS.has(ext) || mime.startsWith("text/")) return "Documents";
  return "Other";
}

// ── Sorting ─────────────────────────────────────────────────────────────────

function sortValue(file: FileRecord, key: SortKey): string | number | null | undefined {
  switch (key) {
    case "name":
      return fileName(file.file_path);
    case "kind":
      return kindLabel(file);
    case "modified":
      return file.modified_at ?? file.timestamp;
    case "created":
      return file.timestamp;
    case "size":
      return file.file_size;
  }
}

export function sortFiles(files: FileRecord[], sort: Arrangement["sort"]): FileRecord[] {
  return [...files].sort(
    (a, b) =>
      compareSortValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.direction) ||
      compareSortValues(fileName(a.file_path), fileName(b.file_path), "asc")
  );
}

// ── Grouping ────────────────────────────────────────────────────────────────

export interface FileGroup {
  label: string;
  files: FileRecord[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Finder's date buckets. Returns [label, rank] where a lower rank is more recent. */
function dateGroup(iso: string | null | undefined, now: Date): [string, number] {
  if (!iso) return ["No Date", Number.MAX_SAFE_INTEGER];
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return ["No Date", Number.MAX_SAFE_INTEGER];
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = date.getTime();
  if (t >= startOfToday) return ["Today", 0];
  if (t >= startOfToday - DAY) return ["Yesterday", 1];
  if (t >= startOfToday - 7 * DAY) return ["Previous 7 Days", 2];
  if (t >= startOfToday - 30 * DAY) return ["Previous 30 Days", 3];
  if (date.getFullYear() === now.getFullYear()) {
    return [MONTHS[date.getMonth()], 10 + (11 - date.getMonth())];
  }
  return [String(date.getFullYear()), 100 + (now.getFullYear() - date.getFullYear())];
}

const MB = 1024 * 1024;
const SIZE_BUCKETS: [number, string][] = [
  [1024 * MB, "More than 1 GB"],
  [100 * MB, "100 MB to 1 GB"],
  [10 * MB, "10 MB to 100 MB"],
  [MB, "1 MB to 10 MB"],
  [100 * 1024, "100 KB to 1 MB"],
  [10 * 1024, "10 KB to 100 KB"],
  [0, "Less than 10 KB"],
];

function sizeGroup(bytes: number | null | undefined): [string, number] {
  if (bytes == null) return ["Unknown Size", SIZE_BUCKETS.length];
  const i = SIZE_BUCKETS.findIndex(([min]) => bytes >= min);
  return [SIZE_BUCKETS[i][1], i];
}

function nameGroup(file: FileRecord): [string, number] {
  const first = fileName(file.file_path).charAt(0).toUpperCase();
  if (/[A-Z]/.test(first)) return [first, first.charCodeAt(0)];
  if (/[0-9]/.test(first)) return ["0–9", 0];
  return ["#", 1000];
}

/**
 * Splits files into Finder-style groups, in Finder's group order, each group
 * sorted by `sort`. With groupBy "none" there is a single unlabelled group.
 */
export function groupFiles(
  files: FileRecord[],
  arrangement: Arrangement,
  now: Date = new Date()
): FileGroup[] {
  const sorted = sortFiles(files, arrangement.sort);
  if (arrangement.groupBy === "none") return [{ label: "", files: sorted }];

  const groups = new Map<string, { rank: number; files: FileRecord[] }>();
  for (const file of sorted) {
    let key: [string, number];
    switch (arrangement.groupBy) {
      case "kind": {
        const category = kindCategory(file);
        key = [category, KIND_CATEGORIES.indexOf(category)];
        break;
      }
      case "modified":
        key = dateGroup(file.modified_at ?? file.timestamp, now);
        break;
      case "created":
        key = dateGroup(file.timestamp, now);
        break;
      case "size":
        key = sizeGroup(file.file_size);
        break;
      case "name":
        key = nameGroup(file);
        break;
    }
    const [label, rank] = key;
    const group = groups.get(label) ?? { rank, files: [] };
    group.files.push(file);
    groups.set(label, group);
  }

  return [...groups.entries()]
    .sort(([, a], [, b]) => a.rank - b.rank)
    .map(([label, g]) => ({ label, files: g.files }));
}
