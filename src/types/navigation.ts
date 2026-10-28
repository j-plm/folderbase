import type { View, ViewNode } from "./index";

export type ViewMode = "tiles" | "list" | "columns" | "database";

export interface ShellView {
  view_id: string;
  name: string;
}

export interface NavigationState {
  activeLocationId: string | null;
  activeViewId: string | null;
  path: string[];
  viewMode: ViewMode;
  views: View[];
  viewNodes: ViewNode[];
  currentLibrary: string | null;
  editHierarchy: boolean;
  masterEditorOpen: boolean;
  /** The location whose Map Disk Folders panel is open, if any. */
  diskFoldersLocationId: string | null;
  /** Whether the Database view's Rules panel is open. Only one side panel (Hierarchy, Map Disk Folders, Rules) is open at once. */
  rulesOpen: boolean;
  navigateTo: (path: string[]) => void;
  pushSegment: (segment: string) => void;
  /** Sets path to path.slice(0, index). index=0 returns to root. */
  popToIndex: (index: number) => void;
  setViewMode: (mode: ViewMode) => void;
  /** Switches to a location, clearing active view and path. */
  setActiveLocation: (locationId: string | null) => void;
  /** Switches to a different view and resets path to []. */
  setActiveView: (viewId: string) => void;
  setEditHierarchy: (v: boolean) => void;
  openMasterEditor: () => void;
  closeMasterEditor: () => void;
  /** Opens Map Disk Folders for a location, switching to it if needed. */
  openDiskFolders: (locationId: string) => void;
  closeDiskFolders: () => void;
  setRulesOpen: (open: boolean) => void;
  refreshViews: () => Promise<void>;
  refreshViewNodes: () => Promise<void>;
}
