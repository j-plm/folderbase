import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNavigation } from "../contexts/NavigationContext";
import { setViewMenuState } from "../lib/commands";
import { platform, viewMenuShortcut } from "../lib/platform";
import { VIEW_MODE_ORDER } from "../lib/previewPane";
import type { ViewMode } from "../types/navigation";

/**
 * View ▸ as Icons … as Database (⌘1 … ⌘5) and Show Preview (⇧⌘P): the menu
 * items switch the main window, and the menu's checkmarks follow whatever
 * switches it, the toolbar too. Elsewhere, their keys (lib/platform).
 */
export function useViewMenu() {
  const { activeLocationId, viewMode, setViewMode, previewShown, togglePreview } = useNavigation();
  const latest = useRef({ activeLocationId, setViewMode, togglePreview });
  latest.current = { activeLocationId, setViewMode, togglePreview };

  useEffect(() => {
    if (platform !== "macos") return;
    void setViewMenuState(viewMode, previewShown).catch(() => {});
  }, [viewMode, previewShown]);

  useEffect(() => {
    const choose = (mode: ViewMode) => {
      if (latest.current.activeLocationId) latest.current.setViewMode(mode);
    };
    const toggle = () => {
      if (latest.current.activeLocationId) latest.current.togglePreview();
    };
    if (platform === "macos") {
      const unlisten = [listen<ViewMode>("menu-view-mode", ({ payload }) => choose(payload)), listen("menu-toggle-preview", toggle)];
      return () => unlisten.forEach((u) => void u.then((f) => f()));
    }
    const onKey = (e: KeyboardEvent) => {
      const shortcut = viewMenuShortcut(e);
      if (!shortcut) return;
      e.preventDefault();
      if ("preview" in shortcut) toggle();
      else choose(VIEW_MODE_ORDER[shortcut.mode - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
