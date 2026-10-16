import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { performEdit } from "../lib/editMenu";
import { hasPrimaryModifier, platform } from "../lib/platform";

/**
 * Connects Undo / Redo to the app. On macOS they come from the Edit menu (which
 * also handles Cmd-Z); elsewhere from Ctrl-Z, Ctrl-Shift-Z and Ctrl-Y.
 */
export function useEditMenu() {
  useEffect(() => {
    if (platform === "macos") {
      const unlisten = Promise.all([
        listen("menu-undo", () => performEdit("undo")),
        listen("menu-redo", () => performEdit("redo")),
      ]);
      return () => {
        unlisten.then((fns) => fns.forEach((fn) => fn()));
      };
    }

    function onKey(e: KeyboardEvent) {
      if (!hasPrimaryModifier(e) || e.altKey) return;
      const key = e.key.toLowerCase();
      const redo = (key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey);
      if (key !== "z" && !redo) return;
      e.preventDefault();
      performEdit(redo ? "redo" : "undo");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
