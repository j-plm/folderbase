import { useCallback, useRef } from "react";
import { useBrowse } from "../contexts/BrowseContext";
import { useFileDrag } from "../contexts/FileDragContext";
import { useNavigation } from "../contexts/NavigationContext";
import { setMetadataCells, type CellEdit } from "../lib/commands";
import type { InfoEdit } from "../lib/info";

/**
 * Writes an edit made in Get Info, the Inspector or the Preview pane: in order
 * with the main window's other changes, and recorded in the location's history
 * so Edit ▸ Undo takes it back. A file of another location has no history open
 * here, so it's only written. `onStale` hears when what was shown may be out of
 * date (a write to another location, or a failed one).
 */
export function useInfoEdit(onStale?: () => void) {
  const browse = useBrowse();
  const drag = useFileDrag();
  const { activeLocationId } = useNavigation();
  const latest = useRef({ browse, drag, activeLocationId, onStale });
  latest.current = { browse, drag, activeLocationId, onStale };

  return useCallback(async ({ locationId, label, edits, before }: InfoEdit) => {
    const { drag, browse, activeLocationId } = latest.current;
    const write = async (cells: CellEdit[]) => {
      await setMetadataCells(cells);
      if (locationId === latest.current.activeLocationId) await latest.current.browse?.refresh();
      else latest.current.onStale?.();
    };
    try {
      if (drag && browse && locationId === activeLocationId) {
        await drag.history.queue(() => write(edits));
        drag.history.push({ label, undo: () => write(before), redo: () => write(edits) });
      } else {
        await write(edits);
      }
    } catch (e) {
      latest.current.onStale?.();
      console.error(`couldn't save “${label}”:`, e);
    }
  }, []);
}
