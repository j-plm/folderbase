import { useEffect } from "react";

const NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * As in Finder, the keyboard always moves through the files and folders:
 * an arrow key (or ⌘A) pressed while nothing in the content has focus — after
 * clicking the sidebar, the toolbar or the path bar, or once a folder has
 * opened — goes to the view showing (marked `data-browse-keys`), which takes
 * focus. Text fields, menus, dialogs and side panels keep their keys.
 */
export function useBrowseKeys(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const selectAll = (e.metaKey || e.ctrlKey) && e.key === "a";
      if (e.defaultPrevented || !(selectAll || (NAVIGATION_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey))) return;
      const active = document.activeElement;
      const outside = !active || active === document.body || !!active.closest("[data-keys-to-browse]");
      if (!outside || active?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (document.querySelector('[role="dialog"]')) return;
      const view = document.querySelector<HTMLElement>("[data-browse-keys]");
      if (!view) return;
      e.preventDefault();
      view.focus({ preventScroll: true });
      view.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: e.key,
          code: e.code,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          bubbles: true,
          cancelable: true,
        })
      );
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
