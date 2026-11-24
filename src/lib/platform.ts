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
  /** Shows a file selected in the OS file manager. */
  reveal: platform === "macos" ? "Show in Finder" : platform === "windows" ? "Show in Explorer" : "Show in Folder",
  /** How to name a toggle-click in hints ("⌘-click to select several"). */
  toggleClick: platform === "macos" ? "⌘-click" : "Ctrl-click",
  /** Get Info, as the file manager names it (Explorer's Properties). */
  getInfo: platform === "macos" ? "Get Info" : "Properties",
  /** The Select All shortcut, in hints. */
  selectAll: platform === "macos" ? "⌘A" : "Ctrl+A",
} as const;

/**
 * Compress's menu item: Finder names what it zips ("Compress “Acme”", "Compress 3 Items");
 * Explorer's is the same whatever's picked. `to`: the version that asks where to save it.
 */
export function compressLabel(count: number, name: string | null, to = false): string {
  if (platform === "windows") return to ? "Compress to ZIP File…" : "Compress to ZIP File";
  const what = count === 1 && name ? `“${name}”` : `${count} Items`;
  return `Compress ${what}${to ? " To…" : ""}`;
}

export const breadcrumbSeparator = platform === "windows" ? "\\" : "/";

export { platform };

interface ModifierEvent {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
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

/** The preview column shows files live (scroll a PDF, play a video) with the OS's own preview view: macOS only so far. */
export const livePreviewAvailable = platform === "macos";

/** View ▸ Show Preview / Hide Preview, as Finder names it; Explorer calls it the Preview pane. */
export function previewLabel(shown: boolean): string {
  if (platform === "windows") return "Preview pane";
  return shown ? "Hide Preview" : "Show Preview";
}

/**
 * Where there's no app menu to carry them (macOS has View ▸ as Icons … and
 * Show Preview): Ctrl+1 … Ctrl+5 for the view modes, in Finder's order, and
 * Alt+P for the Preview pane, as in File Explorer.
 */
export function viewMenuShortcut(e: ModifierEvent): { mode: number } | { preview: true } | null {
  if (platform === "macos") return null;
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key?.toLowerCase() === "p") return { preview: true };
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key && /^[1-5]$/.test(e.key)) return { mode: Number(e.key) };
  return null;
}

/** Space previews the selection (Quick Look), as in Finder; ⌘Y too on macOS. */
export function isQuickLookShortcut(e: ModifierEvent): boolean {
  if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey) return true;
  return platform === "macos" && e.metaKey && !e.altKey && e.key?.toLowerCase() === "y";
}

/** Quick Look's menu item: Finder names what it previews ("Quick Look “report.pdf”", "Quick Look 3 Items"); elsewhere it's Preview. */
export function quickLookLabel(count: number, name: string | null): string {
  if (platform !== "macos") return "Preview";
  return count === 1 && name ? `Quick Look “${name}”` : `Quick Look ${count} Items`;
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

/**
 * Pixels per point in the positions of files dragged in from another app
 * (Tauri's drag-and-drop events). On macOS they're already points, though
 * typed as physical pixels; elsewhere they're physical pixels.
 */
export function dropPositionScale(): number {
  return platform === "macos" ? 1 : window.devicePixelRatio;
}
