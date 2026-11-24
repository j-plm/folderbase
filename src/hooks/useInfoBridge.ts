import { useEffect, useRef } from "react";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useBrowse } from "../contexts/BrowseContext";
import { useFileDrag } from "../contexts/FileDragContext";
import { useLocationViewsOptional } from "../contexts/LocationViewsContext";
import { useNavigation } from "../contexts/NavigationContext";
import { toggleInspector } from "../lib/commands";
import { useInfoEdit } from "./useInfoEdit";
import { getInfo } from "../lib/fileActions";
import { foldersOf } from "../lib/folderTree";
import {
  INFO_BYE,
  INFO_EDIT,
  INFO_GO,
  INFO_HELLO,
  INFO_MAIN_READY,
  INFO_STATE,
  INFO_UNDO,
  type InfoEdit,
  type InfoFolder,
  type InfoGo,
  type InfoHello,
  type InfoState,
} from "../lib/info";
import { hasPrimaryModifier, platform } from "../lib/platform";
import { getSelectedPaths, onSelectedPaths } from "../lib/selectionStatus";

/**
 * The main window's side of Get Info and the Inspector (lib/info.ts): tells each
 * open Info window what to show, with the folders its files show in under the
 * open view; writes their edits into the location's undo history; takes them to
 * a folder when one is clicked. Also File ▸ Get Info (⌘I) on the selection, and
 * its keys where there's no app menu (Alt+Enter, Ctrl+Alt+I).
 */
export function useInfoBridge() {
  const browse = useBrowse();
  const drag = useFileDrag();
  const views = useLocationViewsOptional();
  const { activeLocationId, setActiveLocation } = useNavigation();

  /** Open Info windows by label, with the files each shows (null: the Inspector). */
  const windows = useRef(new Map<string, string[] | null>());
  const revision = useRef(0);

  const files = browse?.files;
  const tree = browse?.tree ?? null;
  const viewName = views?.active ? (views.active.is_default ? "Default" : views.active.name) : null;

  // The latest of everything, for handlers bound once
  const latest = useRef({ browse, drag, activeLocationId, viewName, tree, files, setActiveLocation, applyEdit: null as ReturnType<typeof useInfoEdit> | null });

  const stateFor = (paths: string[]): InfoState => {
    const { tree, files, activeLocationId, viewName } = latest.current;
    const folders: Record<string, InfoFolder[]> = {};
    if (tree && files) {
      const byPath = new Map(files.map((f) => [f.file_path, f.file_id]));
      for (const path of paths.slice(0, 50)) {
        const id = byPath.get(path);
        if (!id) continue;
        folders[path] = foldersOf(tree, id).map((f) => ({ path: f.path, labels: f.steps.map((s) => s.label) }));
      }
    }
    return { paths, locationId: activeLocationId, viewName, folders, revision: revision.current };
  };

  const send = (label: string) => {
    const shown = windows.current.get(label);
    if (shown === undefined) return;
    void emitTo(label, INFO_STATE, stateFor(shown ?? getSelectedPaths())).catch(() => {});
  };
  const sendAll = () => windows.current.forEach((_, label) => send(label));

  // An edit made in an Info window, written into the location's history
  const applyEdit = useInfoEdit(() => {
    revision.current++;
    sendAll();
  });
  latest.current = { browse, drag, activeLocationId, viewName, tree, files, setActiveLocation, applyEdit };

  // Files, folders or the view changed (each reload of the files is a change to read): every Info window hears
  useEffect(() => {
    revision.current++;
    sendAll();
    // `sendAll` reads the latest of these through `latest`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, tree, viewName, activeLocationId]);

  useEffect(() => {
    // The Inspector follows the selection
    const stopSelection = onSelectedPaths(() => {
      if (windows.current.has("inspector")) send("inspector");
    });

    const unlisten = [
      listen<InfoHello>(INFO_HELLO, ({ payload }) => {
        windows.current.set(payload.label, payload.paths);
        send(payload.label);
      }),
      listen<string>(INFO_BYE, ({ payload }) => void windows.current.delete(payload)),
      listen<InfoEdit>(INFO_EDIT, ({ payload }) => void latest.current.applyEdit?.(payload)),
      listen<InfoGo>(INFO_GO, ({ payload }) => {
        const { activeLocationId, setActiveLocation, browse } = latest.current;
        if (payload.locationId !== activeLocationId) setActiveLocation(payload.locationId);
        else browse?.go(payload.path);
        void getCurrentWindow().setFocus();
      }),
      listen<"undo" | "redo">(INFO_UNDO, ({ payload }) => {
        const history = latest.current.drag?.history;
        if (payload === "undo") history?.undo();
        else history?.redo();
      }),
      listen("menu-get-info", () => void getInfo(getSelectedPaths())),
    ];
    // Info windows left open across a reload of this page say hello again
    void Promise.all(unlisten).then(() => emit(INFO_MAIN_READY));

    // Windows and Linux have no app menu to carry the shortcuts
    const onKey = (e: KeyboardEvent) => {
      if (platform === "macos") return;
      if (e.altKey && e.key === "Enter" && !hasPrimaryModifier(e)) {
        e.preventDefault();
        void getInfo(getSelectedPaths());
      } else if (hasPrimaryModifier(e) && e.altKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        void toggleInspector();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      stopSelection();
      unlisten.forEach((u) => void u.then((f) => f()));
      window.removeEventListener("keydown", onKey);
    };
    // Handlers read `latest`, so they're bound once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
