type Platform = "macos" | "windows" | "linux";

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "macos";
  if (ua.includes("windows")) return "windows";
  return "linux";
}

const platform = detectPlatform();

export const labels = {
  sidebar: platform === "macos" ? "Sidebar" : "Navigation",
  trash:
    platform === "windows"
      ? "Delete"
      : "Move to Trash",
  newFolder: "New Folder",
} as const;

export const breadcrumbSeparator = platform === "windows" ? "\\" : "/";

export { platform };

interface ModifierEvent {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  key?: string;
}

/** Cmd-click on macOS, Ctrl-click elsewhere: add or remove one item from a selection. */
export function isToggleSelect(e: ModifierEvent): boolean {
  return platform === "macos" ? e.metaKey : e.ctrlKey;
}

/** The primary shortcut modifier (Cmd on macOS, Ctrl elsewhere), as in Cmd-A. */
export function hasPrimaryModifier(e: ModifierEvent): boolean {
  return platform === "macos" ? e.metaKey : e.ctrlKey;
}

/** Finder opens the selection with Cmd-O or Cmd-Down; Explorer and Linux file managers use Enter. */
export function isOpenShortcut(e: ModifierEvent): boolean {
  if (platform === "macos") return e.metaKey && (e.key === "o" || e.key === "ArrowDown");
  return e.key === "Enter" || (e.ctrlKey && e.key === "o");
}

/**
 * Native context menu row heights, measured from NSMenu on macOS 26: 24pt
 * items, 11pt separators, 5pt padding above the first row. Null where the
 * menu can't be aligned to an item.
 */
export const menuMetrics =
  platform === "macos" ? { item: 24, separator: 11, padding: 5 } : null;
