import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { setSaveViewEnabled } from "../lib/commands";
import { hasPrimaryModifier, platform } from "../lib/platform";
import type { LocationViewsValue } from "../contexts/LocationViewsContext";

/**
 * Cmd-S saves the showing view's edits. On macOS it comes from File ▸ Save
 * View, enabled only while there are edits; elsewhere from Ctrl-S.
 */
export function useSaveViewShortcut(views: LocationViewsValue | null) {
  const edited = !!views?.edited;
  const viewsRef = useRef(views);
  viewsRef.current = views;

  useEffect(() => {
    if (platform !== "macos") return;
    void setSaveViewEnabled(edited).catch(() => {});
    return () => void setSaveViewEnabled(false).catch(() => {});
  }, [edited]);

  useEffect(() => {
    function save() {
      const v = viewsRef.current;
      if (v?.edited) v.saveChanges().catch((e) => v.reportError(String(e)));
    }
    if (platform === "macos") {
      const unlisten = listen("menu-save-view", save);
      return () => {
        unlisten.then((fn) => fn());
      };
    }
    function onKey(e: KeyboardEvent) {
      if (!hasPrimaryModifier(e) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      save();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
