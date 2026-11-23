import { ask } from "@tauri-apps/plugin-dialog";
import { emitTo } from "@tauri-apps/api/event";
import { getLocations, ingestDirectory } from "./commands";

// What Settings does beyond saving a value: asking first, refreshing locations,
// and handing work to the main window (Map Disk Folders and Rules open there).

/** A native alert asking before something that changes files or takes a while. True if confirmed. */
export function confirmAction(title: string, message: string, okLabel: string, destructive = false): Promise<boolean> {
  return ask(message, { title, okLabel, cancelLabel: "Cancel", kind: destructive ? "warning" : "info" });
}

/**
 * Refreshes every location, one after another (as Rebuild Index, and after
 * Show hidden files changes). The sidebar shows each one's progress.
 * `onProgress` hears how many are done. Resolves to the errors, by location name.
 */
export async function refreshAllLocations(onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const locations = await getLocations();
  const errors: string[] = [];
  onProgress?.(0, locations.length);
  for (const [i, location] of locations.entries()) {
    try {
      await ingestDirectory(location.location_id);
    } catch (e) {
      errors.push(`${location.name}: ${String(e)}`);
    }
    onProgress?.(i + 1, locations.length);
  }
  return errors;
}

/** Sent to the main window: open one of a location's panels there and come forward. */
export const OPEN_LOCATION_PANEL = "open-location-panel";

export interface LocationPanelRequest {
  panel: "disk-folders" | "rules";
  locationId: string;
}

export function openLocationPanel(request: LocationPanelRequest): Promise<void> {
  return emitTo("main", OPEN_LOCATION_PANEL, request);
}
