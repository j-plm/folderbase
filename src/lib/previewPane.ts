import type { ViewMode } from "../types/navigation";

// The Preview pane (spec ▸ Preview Pane): shown or hidden per view mode, and
// kept. Columns has its preview column instead; Gallery shows the pane until
// it's hidden.

/** Where whether the pane is shown, per view mode, is kept. */
export const PREVIEW_KEY = "preview-pane";
/** Where the pane's width is kept. */
export const PREVIEW_WIDTH_KEY = "preview-pane-width";

/** The view modes in Finder's View menu order, as ⌘1 … ⌘5 choose them. */
export const VIEW_MODE_ORDER: ViewMode[] = ["tiles", "list", "columns", "gallery", "database"];

export type PreviewModes = Partial<Record<ViewMode, boolean>>;

/** Whether a mode can show the pane at all: Columns keeps its preview column instead. */
export function previewAvailable(mode: ViewMode): boolean {
  return mode !== "columns";
}

/** Whether the pane is shown in a mode: as it was left, else only in Gallery. */
export function previewShown(mode: ViewMode, saved: PreviewModes): boolean {
  if (!previewAvailable(mode)) return false;
  return saved[mode] ?? mode === "gallery";
}

/** Shows or hides the pane in a mode, leaving the others as they were. */
export function togglePreview(mode: ViewMode, saved: PreviewModes): PreviewModes {
  if (!previewAvailable(mode)) return saved;
  return { ...saved, [mode]: !previewShown(mode, saved) };
}

export function savedPreviewModes(): PreviewModes {
  try {
    const saved = JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}
