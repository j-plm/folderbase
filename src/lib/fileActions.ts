import { ask, message } from "@tauri-apps/plugin-dialog";
import {
  appsForPaths,
  getLocations,
  ingestDirectory,
  locationAvailable,
  openPaths,
  openPathsWith,
  pickApplication,
  pickDirectory,
  relocateLocation,
  revealPaths,
  type Location,
  type OpenWithApp,
} from "./commands";
import type { MenuEntry } from "./nativeMenu";
import { labels } from "./platform";

/** Matches the error starts in `commands::admin` (`FILE_NOT_FOUND`, `NO_APPLICATION`). */
const FILE_NOT_FOUND = "file not found: ";
const NO_APPLICATION = "no application: ";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** The location `path` sits in, the most specific when one's folder holds another's. */
export function locationOf(path: string, locations: Location[]): Location | null {
  const holding = locations.filter((l) => path.startsWith(`${l.root_path}/`) || path.startsWith(`${l.root_path}\\`));
  return holding.sort((a, b) => b.root_path.length - a.root_path.length)[0] ?? null;
}

/** Opens files together, as a double-click does, saying why when they can't be (as Finder does). */
export async function openFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await openPaths(paths);
  } catch (e) {
    await explainOpenFailure(String(e), paths);
  }
}

/** Opens files in a chosen app. */
async function openFilesWith(paths: string[], app: string): Promise<void> {
  try {
    await openPathsWith(paths, app);
  } catch (e) {
    await explainOpenFailure(String(e), paths);
  }
}

/** Opens files in an app picked from Applications (Open With ▸ Other…). */
async function openFilesWithOther(paths: string[]): Promise<void> {
  const app = await pickApplication();
  if (app) await openFilesWith(paths, app);
}

async function revealFiles(paths: string[]): Promise<void> {
  try {
    await revealPaths(paths);
  } catch (e) {
    await explainOpenFailure(String(e), paths);
  }
}

async function explainOpenFailure(error: string, paths: string[]): Promise<void> {
  if (error.startsWith(NO_APPLICATION)) {
    const path = error.slice(NO_APPLICATION.length);
    const choose = await ask(`There is no application set to open the document “${fileName(path)}”.`, {
      kind: "warning",
      okLabel: "Choose Application…",
      cancelLabel: "Cancel",
    });
    if (choose) await openFilesWithOther(paths);
    return;
  }
  if (error.startsWith(FILE_NOT_FOUND)) {
    const path = error.slice(FILE_NOT_FOUND.length);
    const location = locationOf(path, await getLocations().catch(() => []));
    // The whole location's folder has gone (moved, or a cloud drive renamed it): point it at the new place
    if (location && !(await locationAvailable(location.location_id).catch(() => true))) {
      const locate = await ask(
        `The folder of the location “${location.name}” can’t be found. If it has moved, locate it to bring back its files, with their values.`,
        { title: `“${fileName(path)}” can’t be found.`, kind: "warning", okLabel: "Locate Folder…", cancelLabel: "OK" }
      );
      if (locate) await locateLocationFolder(location);
      return;
    }
    await message(
      `It may have been moved, renamed or deleted. Refresh the location to bring it up to date.`,
      { title: `The item “${fileName(path)}” can’t be found.`, kind: "warning" }
    );
    return;
  }
  await message(error, { title: `“${fileName(paths[0])}” can’t be opened.`, kind: "error" });
}

/**
 * Asks for the location's folder in its new place and points the location (and
 * any missing ones that moved along with it) there, then refreshes each. Resolves
 * to the locations moved (none if the user cancelled).
 */
export async function locateLocationFolder(location: Location): Promise<Location[]> {
  // Start near where it was, as far up as is still there
  const parent = location.root_path.replace(/[\\/][^\\/]*$/, "");
  const folder = await pickDirectory(parent || undefined);
  if (!folder) return [];
  try {
    const moved = await relocateLocation(location.location_id, folder);
    for (const l of moved) void ingestDirectory(l.location_id).catch(() => {});
    if (moved.length > 1) {
      const others = moved.slice(1).map((l) => `“${l.name}”`).join(", ");
      await message(`${others} had moved along with it, and now point at their new place too.`, {
        title: `“${location.name}” found`,
      });
    }
    return moved;
  } catch (e) {
    await message(String(e), { title: `“${location.name}” couldn’t be moved there`, kind: "error" });
    return [];
  }
}

/** Open With's items: the default app marked and first, then the rest, then Other…. */
export function openWithEntries(apps: OpenWithApp[], open: (app: string) => void, other: () => void): MenuEntry[] {
  const defaults = apps.filter((a) => a.is_default);
  const rest = apps.filter((a) => !a.is_default);
  const item = (a: OpenWithApp, text = a.name): MenuEntry => ({ type: "item", text, action: () => open(a.path) });
  const entries: MenuEntry[] = defaults.map((a) => item(a, `${a.name} (default)`));
  if (entries.length > 0 && rest.length > 0) entries.push({ type: "separator" });
  entries.push(...rest.map((a) => item(a)));
  if (entries.length > 0) entries.push({ type: "separator" });
  entries.push({ type: "item", text: "Other…", action: other });
  return entries;
}

/** A file's own right-click items, wherever it's shown: Open, Open With ▸, Show in Finder. */
export function fileEntries(paths: string[]): MenuEntry[] {
  return [
    { type: "item", text: "Open", action: () => void openFiles(paths) },
    {
      type: "submenu",
      text: "Open With",
      items: [],
      load: async () =>
        openWithEntries(
          await appsForPaths(paths).catch(() => []),
          (app) => void openFilesWith(paths, app),
          () => void openFilesWithOther(paths)
        ),
    },
    { type: "separator" },
    { type: "item", text: labels.reveal, action: () => void revealFiles(paths) },
  ];
}
