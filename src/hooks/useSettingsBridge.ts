import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openSettings } from "../lib/commands";
import { hasPrimaryModifier, platform } from "../lib/platform";
import { OPEN_LOCATION_PANEL, type LocationPanelRequest } from "../lib/settingsActions";
import { useNavigation } from "../contexts/NavigationContext";

/**
 * The main window's side of the Settings window: Ctrl+, opens it where there's
 * no app menu to carry ⌘, (macOS has Folderbase ▸ Settings…), and its Edit…
 * buttons for Map Disk Folders and Rules open those panels here.
 */
export function useSettingsBridge() {
  const { openDiskFolders, setActiveLocation, setViewMode, setRulesOpen, activeLocationId } = useNavigation();

  useEffect(() => {
    if (platform === "macos") return;
    const onKey = (e: KeyboardEvent) => {
      if (hasPrimaryModifier(e) && e.key === ",") {
        e.preventDefault();
        void openSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const unlisten = listen<LocationPanelRequest>(OPEN_LOCATION_PANEL, ({ payload }) => {
      if (payload.panel === "disk-folders") {
        openDiskFolders(payload.locationId);
      } else {
        // Rules belongs to the Database view
        if (payload.locationId !== activeLocationId) setActiveLocation(payload.locationId);
        setViewMode("database");
        setRulesOpen(true);
      }
      void getCurrentWindow().setFocus();
    });
    return () => void unlisten.then((f) => f());
  }, [openDiskFolders, setActiveLocation, setViewMode, setRulesOpen, activeLocationId]);
}
