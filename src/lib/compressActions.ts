import { listen } from "@tauri-apps/api/event";
import { COMPRESS_CANCELLED, cancelCompress, compressItems, pickZipDestination, revealPaths } from "./commands";
import { archivePlan, hasFiles, itemsName, type ArchivePlan } from "./compress";
import type { DragItem } from "./filing";
import type { FolderTree } from "./folderTree";
import type { MenuEntry } from "./nativeMenu";
import { compressLabel } from "./platform";
import { appSettings, chooseZipFolder, zipFolder } from "./appSettings";

// Compress from any right-click menu: the zip goes to the zip folder (Downloads
// unless Settings says otherwise), or (⌥ held as the menu opens) wherever a save
// panel says. Each one shows as a notice (components/shell/CompressNotices) while
// it runs, then with Show in Finder and Change… (the zip folder).

export interface CompressJob {
  id: string;
  name: string;
  done: number;
  total: number;
  state: "running" | "done" | "failed";
  /** The zip, once it's written. */
  path?: string;
  error?: string;
  /** Kept open (hovered, or used): it doesn't go by itself. */
  keep?: boolean;
  /** Where zips go from now on, once Change… has chosen it. */
  changedTo?: string;
}

let jobs: CompressJob[] = [];
const listeners = new Set<() => void>();

function setJobs(next: CompressJob[]) {
  jobs = next;
  listeners.forEach((l) => l());
}
const update = (id: string, change: Partial<CompressJob>) => setJobs(jobs.map((j) => (j.id === id ? { ...j, ...change } : j)));

export const compressJobs = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  snapshot: () => jobs,
  dismiss: (id: string) => setJobs(jobs.filter((j) => j.id !== id)),
  cancel: (id: string) => void cancelCompress(id),
  reveal: (path: string) => void revealPaths([path]).catch(() => {}),
  keep: (id: string) => update(id, { keep: true }),
  /** Change… on a finished zip: picks the folder zips go to from now on (this one stays where it is). */
  async changeFolder(id: string) {
    update(id, { keep: true });
    const folder = await chooseZipFolder().catch(() => null);
    if (folder) update(id, { changedTo: folder });
  },
};

/** How long a finished zip's notice stays. */
const DONE_NOTICE_MS = 8000;

// Native menus can't swap in an alternate item while ⌥ is held, so ⌥ is read
// as the right-click happens: the menu built for it offers Compress To…
let optionHeld = false;
if (typeof window !== "undefined") {
  window.addEventListener("contextmenu", (e) => (optionHeld = e.altKey), true);
}

/** Zips a plan into the zip folder, or where a save panel says when `ask`. */
export async function compress(plan: ArchivePlan, ask = false): Promise<void> {
  if (plan.entries.length === 0) return;
  let destination: string | null = null;
  if (ask) {
    if (!zipFolder()) await appSettings.load();
    destination = await pickZipDestination(plan.name, zipFolder() ?? undefined);
    if (!destination) return;
  }
  const id = crypto.randomUUID();
  setJobs([...jobs, { id, name: plan.name, done: 0, total: 0, state: "running" }]);
  const unlisten = await listen<{ job: string; done: number; total: number }>("compress_progress", (e) => {
    if (e.payload.job === id) update(id, { done: e.payload.done, total: e.payload.total });
  });
  try {
    const path = await compressItems(id, plan.name, plan.entries, destination);
    // Named as it landed ("Acme 2.zip" when Downloads had an Acme.zip)
    update(id, { state: "done", path, name: path.split(/[\\/]/).pop() ?? plan.name });
    window.setTimeout(() => {
      if (!jobs.find((j) => j.id === id)?.keep) compressJobs.dismiss(id);
    }, DONE_NOTICE_MS);
  } catch (e) {
    if (String(e) === COMPRESS_CANCELLED) compressJobs.dismiss(id);
    else update(id, { state: "failed", error: String(e) });
  } finally {
    unlisten();
  }
}

/**
 * The Compress item for what was right-clicked: folders zip as the folders
 * below them (`tree`), files as they are. `here` names a zip of several items.
 */
export function compressEntry(items: DragItem[], tree: FolderTree | null, here: string | null): MenuEntry {
  const { count, name } = itemsName(items, tree);
  const ask = optionHeld;
  return {
    type: "item",
    text: compressLabel(count, name, ask),
    enabled: hasFiles(items, tree),
    action: () => void compress(archivePlan(items, tree, here), ask),
  };
}
