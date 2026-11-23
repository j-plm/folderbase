import { useEffect } from "react";
import { getLocations } from "../lib/commands";
import { appSettings } from "../lib/appSettings";
import { launchLocation } from "../lib/settingsText";
import { LAST_LOCATION_KEY, useNavigation } from "../contexts/NavigationContext";

/**
 * Opens a location as Folderbase starts (Settings ▸ General ▸ On launch): the
 * last one open, at the view it was on, or the first in the sidebar.
 */
export function useLaunchLocation() {
  const { setActiveLocation } = useNavigation();
  useEffect(() => {
    let live = true;
    void (async () => {
      await appSettings.load();
      const locations = await getLocations().catch(() => []);
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST_LOCATION_KEY);
      } catch {
        // none remembered
      }
      const id = launchLocation(appSettings.snapshot().settings.on_launch, locations.map((l) => l.location_id), last);
      if (live && id) setActiveLocation(id);
    })();
    return () => {
      live = false;
    };
    // Once, as the window opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
