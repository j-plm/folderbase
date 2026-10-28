import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { useTableViews, type TableViews } from "../components/views/db/useTableViews";
import {
  legacyTable,
  workingDefinition,
  type FolderDefinition,
  type TableDefinition,
  type ViewDefinition,
} from "../lib/tableViews";

function loadJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The Database view's side of the views: it shows each view put in place, and their errors. */
export interface ViewTable {
  apply: (def: ViewDefinition) => void;
  onError: (message: string) => void;
}

export interface LocationViewsValue extends Omit<TableViews, "record" | "current"> {
  /** What the active view shows (null while loading). */
  definition: ViewDefinition | null;
  /** The Database view's table changed; the view's folders stay as they are. */
  recordTable: (table: TableDefinition) => void;
  /** The hierarchy changed; the table stays as it is. */
  recordFolders: (folders: FolderDefinition) => void;
  /** The Database view joins in: shown the active view now and each one put in place later. Returns a disconnect. */
  connect: (table: ViewTable) => () => void;
  /** Shows an error about the views (in the Database view when it's open). */
  reportError: (message: string) => void;
}

const LocationViewsContext = createContext<LocationViewsValue | null>(null);

/**
 * The location's saved views (spec ▸ Views), shared by every view mode: the
 * Database view shows a view's table, the hierarchy its folders.
 */
export function LocationViewsProvider({ locationId, children }: { locationId: string; children: ReactNode }) {
  const tableRef = useRef<ViewTable | null>(null);
  const apply = useCallback((def: ViewDefinition) => tableRef.current?.apply(def), []);
  const onError = useCallback((message: string) => {
    if (tableRef.current) tableRef.current.onError(message);
    else console.error(message);
  }, []);
  // The default view starts from the column settings kept before views existed
  const initial = useCallback(() => ({ table: legacyTable((key) => loadJson(`${key}-${locationId}`)) }), [locationId]);
  const views = useTableViews(locationId, apply, initial, onError);
  const { record, current, active } = views;

  const recordTable = useCallback(
    (table: TableDefinition) => {
      const now = current();
      if (now) record({ ...now, table });
    },
    [record, current]
  );
  const recordFolders = useCallback(
    (folders: FolderDefinition) => {
      const now = current();
      if (now) record({ ...now, folders });
    },
    [record, current]
  );
  const connect = useCallback(
    (table: ViewTable) => {
      tableRef.current = table;
      const now = current();
      if (now) table.apply(now);
      return () => {
        if (tableRef.current === table) tableRef.current = null;
      };
    },
    [current]
  );

  const definition = useMemo(() => (active ? workingDefinition(active) : null), [active]);
  const value = useMemo<LocationViewsValue>(
    () => ({
      views: views.views,
      active,
      edited: views.edited,
      select: views.select,
      saveChanges: views.saveChanges,
      revert: views.revert,
      saveAs: views.saveAs,
      create: views.create,
      rename: views.rename,
      remove: views.remove,
      reorder: views.reorder,
      setDefault: views.setDefault,
      flush: views.flush,
      reload: views.reload,
      definition,
      recordTable,
      recordFolders,
      connect,
      reportError: onError,
    }),
    [views, active, definition, recordTable, recordFolders, connect, onError]
  );
  return <LocationViewsContext.Provider value={value}>{children}</LocationViewsContext.Provider>;
}

export function useLocationViews(): LocationViewsValue {
  const ctx = useContext(LocationViewsContext);
  if (!ctx) throw new Error("useLocationViews must be used within LocationViewsProvider");
  return ctx;
}

/** The location's views, or null when no location is showing (the toolbar, the main pane). */
export function useOptionalLocationViews(): LocationViewsValue | null {
  return useContext(LocationViewsContext);
}
