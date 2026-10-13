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
  editStructure: boolean;
  masterEditorOpen: boolean;
  navigateTo: (path: string[]) => void;
  pushSegment: (segment: string) => void;
  /** Sets path to path.slice(0, index). index=0 returns to root. */
  popToIndex: (index: number) => void;
  setViewMode: (mode: ViewMode) => void;
  /** Switches to a location, clearing active view and path. */
  setActiveLocation: (locationId: string | null) => void;
  /** Switches to a different view and resets path to []. */
  setActiveView: (viewId: string) => void;
  setEditStructure: (v: boolean) => void;
  openMasterEditor: () => void;
  closeMasterEditor: () => void;
  refreshViews: () => Promise<void>;
  refreshViewNodes: () => Promise<void>;
}
