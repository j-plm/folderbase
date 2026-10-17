import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { NavigationState, ViewMode } from "../types/navigation";
import type { View, ViewNode } from "../types";
import { getViews, getViewNodes } from "../lib/commands";

interface State {
  activeLocationId: string | null;
  activeViewId: string | null;
  path: string[];
  viewMode: ViewMode;
  views: View[];
  viewNodes: ViewNode[];
  editStructure: boolean;
  masterEditorOpen: boolean;
  structureLocationId: string | null;
}

export type NavAction =
  | { type: "SET_LOCATION"; locationId: string | null }
  | { type: "SET_VIEW"; viewId: string }
  | { type: "NAVIGATE_TO"; path: string[] }
  | { type: "PUSH_SEGMENT"; segment: string }
  | { type: "POP_TO_INDEX"; index: number }
  | { type: "SET_VIEW_MODE"; mode: ViewMode }
  | { type: "SET_VIEWS"; views: View[] }
  | { type: "SET_VIEW_NODES"; nodes: ViewNode[] }
  | { type: "SET_EDIT_STRUCTURE"; value: boolean }
  | { type: "SET_MASTER_EDITOR"; open: boolean }
  | { type: "OPEN_STRUCTURE"; locationId: string }
  | { type: "CLOSE_STRUCTURE" };

const initialState: State = {
  activeLocationId: null,
  activeViewId: null,
  path: [],
  viewMode: "database",
  views: [],
  viewNodes: [],
  editStructure: false,
  masterEditorOpen: false,
  structureLocationId: null,
};

export function navigationReducer(state: State, action: NavAction): State {
  switch (action.type) {
    case "SET_LOCATION":
      return { ...state, activeLocationId: action.locationId, activeViewId: null, path: [], structureLocationId: null };
    case "SET_VIEW":
      return { ...state, activeViewId: action.viewId, path: [], editStructure: false };
    case "NAVIGATE_TO":
      return { ...state, path: action.path };
    case "PUSH_SEGMENT":
      return { ...state, path: [...state.path, action.segment] };
    case "POP_TO_INDEX":
      return { ...state, path: state.path.slice(0, action.index) };
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.mode };
    case "SET_VIEWS":
      return { ...state, views: action.views };
    case "SET_VIEW_NODES":
      return { ...state, viewNodes: action.nodes };
    case "SET_EDIT_STRUCTURE":
      return { ...state, editStructure: action.value };
    case "SET_MASTER_EDITOR":
      return { ...state, masterEditorOpen: action.open };
    case "OPEN_STRUCTURE": {
      // Map Structure opens over the location's files, so switch to it first
      const switching = state.activeLocationId !== action.locationId;
      return {
        ...state,
        ...(switching ? { activeLocationId: action.locationId, activeViewId: null, path: [] } : {}),
        structureLocationId: action.locationId,
      };
    }
    case "CLOSE_STRUCTURE":
      return { ...state, structureLocationId: null };
  }
}

export const NavigationContext = createContext<NavigationState | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(navigationReducer, initialState);

  // Load views on mount (kept dormant — views system is hidden from UI)
  useEffect(() => {
    getViews()
      .then((views) => dispatch({ type: "SET_VIEWS", views }))
      .catch(() => {});
  }, []);

  // Load view nodes whenever active view changes
  useEffect(() => {
    if (state.activeViewId) {
      getViewNodes(state.activeViewId)
        .then((nodes) => dispatch({ type: "SET_VIEW_NODES", nodes }))
        .catch(() => {});
    } else {
      dispatch({ type: "SET_VIEW_NODES", nodes: [] });
    }
  }, [state.activeViewId]);

  const refreshViews = useCallback(async () => {
    const views = await getViews();
    dispatch({ type: "SET_VIEWS", views });
  }, []);

  const refreshViewNodes = useCallback(async () => {
    if (state.activeViewId) {
      const nodes = await getViewNodes(state.activeViewId);
      dispatch({ type: "SET_VIEW_NODES", nodes });
    }
  }, [state.activeViewId]);

  const currentView = state.views.find((v) => v.view_id === state.activeViewId) ?? null;

  const value: NavigationState = {
    ...state,
    currentLibrary: currentView?.library ?? null,
    navigateTo: (path) => dispatch({ type: "NAVIGATE_TO", path }),
    pushSegment: (segment) => dispatch({ type: "PUSH_SEGMENT", segment }),
    popToIndex: (index) => dispatch({ type: "POP_TO_INDEX", index }),
    setViewMode: (mode) => dispatch({ type: "SET_VIEW_MODE", mode }),
    setActiveLocation: (locationId) => dispatch({ type: "SET_LOCATION", locationId }),
    setActiveView: (viewId) => dispatch({ type: "SET_VIEW", viewId }),
    setEditStructure: (v) => dispatch({ type: "SET_EDIT_STRUCTURE", value: v }),
    openMasterEditor: () => dispatch({ type: "SET_MASTER_EDITOR", open: true }),
    closeMasterEditor: () => dispatch({ type: "SET_MASTER_EDITOR", open: false }),
    openStructureMapping: (locationId) => dispatch({ type: "OPEN_STRUCTURE", locationId }),
    closeStructureMapping: () => dispatch({ type: "CLOSE_STRUCTURE" }),
    refreshViews,
    refreshViewNodes,
  };

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationState {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
