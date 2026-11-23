import { downloadDir } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";
import {
  APP_SETTINGS_CHANGED,
  getAppSettings,
  pickDirectory,
  setAppSettings,
  setZipFolder,
  type AppSettings,
  type SettingsPatch,
} from "./commands";

// App-wide settings, as every window shares them. The Settings window changes
// them; Rust saves them and tells every window (APP_SETTINGS_CHANGED), so the
// main window follows a change made in Settings at once, and the other way round.

export const DEFAULT_SETTINGS: AppSettings = {
  zip_folder: null,
  first_view_mode: "database",
  on_launch: "last",
  show_hidden_files: false,
  missing_check: "periodic",
  new_views: {
    group_by_hierarchy: false,
    non_empty_columns: true,
    wrap_multi_select: true,
    freeze_name: true,
    no_value: "folder",
    skip_single: false,
    show_all_values: false,
  },
  backup: { schedule: "daily", folder: null, last_backup: null, folder_asked: false },
};

interface State {
  settings: AppSettings;
  /** The Downloads folder's path, for showing and starting pickers there. */
  downloads: string | null;
  /** Read from Rust yet (until then, the defaults). */
  loaded: boolean;
}

let state: State = { settings: DEFAULT_SETTINGS, downloads: null, loaded: false };
const listeners = new Set<() => void>();
const set = (change: Partial<State>) => {
  state = { ...state, ...change };
  listeners.forEach((l) => l());
};

let loading: Promise<void> | null = null;

export const appSettings = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  snapshot: () => state,
  /** Reads the settings (once; later changes arrive by event). */
  load(): Promise<void> {
    loading ??= (async () => {
      void listen<AppSettings>(APP_SETTINGS_CHANGED, (e) => set({ settings: e.payload, loaded: true }));
      const [settings, downloads] = await Promise.all([getAppSettings().catch(() => state.settings), downloadDir().catch(() => null)]);
      set({ settings, downloads, loaded: true });
    })();
    return loading;
  },
  /** Changes some settings; every window follows. */
  async update(patch: SettingsPatch): Promise<void> {
    set({ settings: await setAppSettings(patch) });
  },
};

/** The folder zips go to now: the one chosen, else Downloads (null until known). */
export function zipFolder(s: Pick<State, "settings" | "downloads"> = state): string | null {
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
