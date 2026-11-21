import type { DragItem } from "./filing";
import { folderLabel } from "./filing";
import type { FolderTree } from "./folderTree";
import type { FileRecord } from "../types";

// Compress: what goes in a zip, laid out as the view shows it (spec ▸ Compress).
// Folders become the folders you see, named as they show ("No Client" too), not
// where the files sit on disk; files picked from a flat list sit at the top.

/** One file in the zip: where it goes inside, and where it is on disk. */
export interface ArchiveEntry {
  archive_path: string;
  disk_path: string;
}

export interface ArchivePlan {
  /** The zip's name: "Acme.zip", "report.pdf.zip", "Archive.zip". */
  name: string;
  entries: ArchiveEntry[];
}

/** The name a zip of several items takes when there's no folder to name it after, as in Finder. */
export const ARCHIVE_NAME = "Archive";

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/** A folder or file name that's safe inside a zip: no slashes or colons, never empty or a dot. */
export function safeName(name: string): string {
  const cleaned = [...name.replace(/[\\/:]/g, "-")].filter((c) => c.charCodeAt(0) >= 0x20).join("").trim();
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "Untitled" : cleaned;
}

/** Hands out names within each folder of the zip, numbering one that's taken ("report 2.pdf"), case aside. */
function namer() {
  const taken = new Map<string, Set<string>>();
  return (dir: string, name: string, isFolder: boolean): string => {
    let used = taken.get(dir);
    if (!used) taken.set(dir, (used = new Set()));
    const dot = isFolder ? -1 : name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} ${n}${ext}`;
    used.add(candidate.toLowerCase());
    return dir ? `${dir}/${candidate}` : candidate;
  };
}

/**
 * The zip of what was right-clicked: each folder as itself with the folders
 * below it, each file on its own at the top. `tree` lays out the folders (none
 * in the Database view, where only files are picked). `here` names a zip of
 * several items: the folder they're in, or "Archive".
 */
export function archivePlan(items: DragItem[], tree: FolderTree | null, here: string | null): ArchivePlan {
  const name = namer();
  const entries: ArchiveEntry[] = [];
  const addFile = (dir: string, file: FileRecord) =>
    entries.push({ archive_path: name(dir, safeName(baseName(file.file_path)), false), disk_path: file.file_path });

  const addFolder = (dir: string, path: string[]) => {
    if (!tree) return;
    const contents = tree.contents(path);
    for (const folder of contents.folders) {
      // Folders with nothing in them yet (made with New Folder, or every registered value) stay out
      if (folder.count === 0) continue;
      addFolder(name(dir, safeName(folder.label), true), [...path, folder.value]);
    }
    for (const file of contents.files) addFile(dir, file);
  };

  const seen = new Set<string>();
  for (const item of items) {
    if (item.kind === "file") {
      // The same file picked twice (as it is from two folders) goes in once
      if (seen.has(item.file.file_id)) continue;
      seen.add(item.file.file_id);
      addFile("", item.file);
    } else if (tree) {
      addFolder(name("", safeName(folderLabel(tree, item.path, here ?? ARCHIVE_NAME)), true), item.path);
    }
  }

  const only = items.length === 1 ? items[0] : null;
  const zipName =
    only?.kind === "file"
      ? baseName(only.file.file_path)
      : only?.kind === "folder" && tree
        ? folderLabel(tree, only.path, here ?? ARCHIVE_NAME)
        : (here ?? ARCHIVE_NAME);
  return { name: `${safeName(zipName)}.zip`, entries };
}

/** What a menu calls the items: the one item's name, or how many there are. */
export function itemsName(items: DragItem[], tree: FolderTree | null): { count: number; name: string | null } {
  if (items.length !== 1) return { count: items.length, name: null };
  const item = items[0];
  if (item.kind === "file") return { count: 1, name: baseName(item.file.file_path) };
  return { count: 1, name: tree ? folderLabel(tree, item.path, ARCHIVE_NAME) : null };
}

/** Whether there's anything to zip: some file, or a folder with files in it. */
export function hasFiles(items: DragItem[], tree: FolderTree | null): boolean {
  return items.some((i) => i.kind === "file" || (tree !== null && tree.filesAt(i.path).length > 0));
}
