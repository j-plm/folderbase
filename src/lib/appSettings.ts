import { downloadDir } from "@tauri-apps/api/path";
import { getAppSettings, pickDirectory, setZipFolder, type AppSettings } from "./commands";

// App-wide settings, as the Settings window and the rest of the app share them,
// and whether that window is open (Folderbase ▸ Settings…, ⌘,).

interface State {
  settings: AppSettings;
  /** The Downloads folder's path, for showing and starting pickers there. */
  downloads: string | null;
  open: boolean;
}

let state: State = { settings: { zip_folder: null }, downloads: null, open: false };
const listeners = new Set<() => void>();
const set = (change: Partial<State>) => {
  state = { ...state, ...change };
  listeners.forEach((l) => l());
};

export const appSettings = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  snapshot: () => state,
  async load() {
    const [settings, downloads] = await Promise.all([getAppSettings().catch(() => state.settings), downloadDir().catch(() => null)]);
    set({ settings, downloads });
  },
  setOpen: (open: boolean) => set({ open }),
};

/** The folder zips go to now: the one chosen, else Downloads (null until known). */
export function zipFolder(s: State = state): string | null {
  return s.settings.zip_folder ?? s.downloads;
}

/** A folder's name as Finder shows it ("Downloads"). */
export const folderName = (path: string | null) => (path ? (path.split(/[\\/]/).filter(Boolean).pop() ?? path) : "Downloads");

/** Asks for a new folder for zips, starting at the current one. Resolves to it, or null if cancelled. */
export async function chooseZipFolder(): Promise<string | null> {
  const folder = await pickDirectory(zipFolder() ?? undefined);
  if (!folder) return null;
  set({ settings: await setZipFolder(folder) });
  return folder;
}

/** Zips go back to Downloads. */
export async function resetZipFolder(): Promise<void> {
  set({ settings: await setZipFolder(null) });
}
