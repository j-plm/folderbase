import { useCallback, useEffect, useRef, useState } from "react";
import { deleteLocationView, getLocationViews, saveLocationView } from "../../../lib/commands";
import {
  DEFAULT_VIEW_NAME,
  parseViewDefinition,
  sameViewDefinition,
  serializeViewDefinition,
  workingDefinition,
  type StoredView,
  type ViewDefinition,
} from "../../../lib/tableViews";

/**
 * Each location's views and the one showing, kept across mounts: switching to
 * Tiles and back (which remounts the table) picks up where it left off at once.
 */
const cache = new Map<string, { views: StoredView[]; activeId: string }>();

const ACTIVE_KEY = (locationId: string) => `db-view-${locationId}`;
/** Edits save this long after the last one, so dragging a column doesn't write on every step. */
const SAVE_DELAY = 400;

function rememberActive(locationId: string, viewId: string) {
  try {
    localStorage.setItem(ACTIVE_KEY(locationId), viewId);
  } catch {
    // Which view was showing is a convenience; the default is shown otherwise
  }
}

function recalledActive(locationId: string): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY(locationId));
  } catch {
    return null;
  }
}

export interface TableViews {
  views: StoredView[];
  /** The view showing (null while loading). */
  active: StoredView | null;
  /** A named view with unsaved edits. */
  edited: boolean;
  /** The table's current state: saved into the default view, or kept as a named view's edits. */
  record: (def: ViewDefinition) => void;
  select: (viewId: string) => Promise<void>;
  saveChanges: () => Promise<void>;
  revert: () => Promise<void>;
  /** A new view of what's showing, which then shows; the view it came from goes back to as saved. */
  saveAs: (name: string) => Promise<void>;
  rename: (viewId: string, name: string) => Promise<void>;
  remove: (viewId: string) => Promise<void>;
  /** Writes any edits waiting to be saved. */
  flush: () => Promise<void>;
  /** Re-reads the views (after the database changed them, as a property rename does), keeping what's showing. */
  reload: () => Promise<void>;
}

/**
 * A location's saved views (spec ▸ Views). The default view saves as it
 * changes; a named view keeps edits as a draft, marked Edited, until saved or
 * reverted. `apply` puts a definition into the table; `initial` gives the
 * default view's first definition.
 */
export function useTableViews(
  locationId: string,
  apply: (def: ViewDefinition) => void,
  initial: () => ViewDefinition,
  onError: (message: string) => void
): TableViews {
  const [views, setViewsState] = useState<StoredView[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const viewsRef = useRef(views);
  const activeIdRef = useRef(activeId);
  /** Views written to state but not yet to the database, by id. */
  const pending = useRef(new Map<string, StoredView>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Writes run one at a time, in order. */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const setViews = useCallback(
    (next: StoredView[]) => {
      viewsRef.current = next;
      setViewsState(next);
      if (activeIdRef.current) cache.set(locationId, { views: next, activeId: activeIdRef.current });
    },
    [locationId]
  );

  const setActive = useCallback(
    (id: string | null) => {
      activeIdRef.current = id;
      setActiveIdState(id);
      if (id) {
        cache.set(locationId, { views: viewsRef.current, activeId: id });
        rememberActive(locationId, id);
      }
    },
    [locationId]
  );

  const write = useCallback((view: StoredView) => {
    const run = chain.current.then(() => saveLocationView(view));
    chain.current = run.catch(() => {});
    return run;
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const waiting = [...pending.current.values()];
    pending.current.clear();
    for (const view of waiting) write(view).catch((e) => onErrorRef.current(String(e)));
    await chain.current;
  }, [write]);

  /** Puts a changed view in state now, and in the database shortly. */
  const stage = useCallback(
    (view: StoredView) => {
      setViews(viewsRef.current.map((v) => (v.view_id === view.view_id ? view : v)));
      pending.current.set(view.view_id, view);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY);
    },
    [setViews, flush]
  );

  // Load the location's views (creating its default view the first time) and show one
  useEffect(() => {
    let stale = false;
    const show = (list: StoredView[], id: string) => {
      viewsRef.current = list;
      setViewsState(list);
      setActive(id);
      const view = list.find((v) => v.view_id === id);
      if (view) applyRef.current(workingDefinition(view));
    };
    const cached = cache.get(locationId);
    if (cached) {
      show(cached.views, cached.activeId);
    } else {
      setActive(null);
      (async () => {
        let list = await getLocationViews(locationId);
        if (!list.some((v) => v.is_default)) {
          const created = await saveLocationView({
            view_id: "",
            location_id: locationId,
            name: DEFAULT_VIEW_NAME,
            is_default: true,
            position: 0,
            definition: serializeViewDefinition(initialRef.current()),
            draft: null,
          });
          list = [created, ...list];
        }
        if (stale) return;
        const recalled = recalledActive(locationId);
        const id = list.find((v) => v.view_id === recalled)?.view_id ?? list.find((v) => v.is_default)!.view_id;
        show(list, id);
      })().catch((e) => onErrorRef.current(String(e)));
    }
    return () => {
      stale = true;
      // Leaving the location (or the Database view): keep its edits
      void flush();
    };
  }, [locationId, setActive, flush]);

  const active = views.find((v) => v.view_id === activeId) ?? null;

  const record = useCallback(
    (def: ViewDefinition) => {
      const view = viewsRef.current.find((v) => v.view_id === activeIdRef.current);
      if (!view || sameViewDefinition(def, workingDefinition(view))) return;
      if (view.is_default) {
        stage({ ...view, definition: serializeViewDefinition(def) });
      } else {
        const saved = sameViewDefinition(def, parseViewDefinition(view.definition));
        stage({ ...view, draft: saved ? null : serializeViewDefinition(def) });
      }
    },
    [stage]
  );

  const select = useCallback(
    async (viewId: string) => {
      const view = viewsRef.current.find((v) => v.view_id === viewId);
      if (!view || viewId === activeIdRef.current) return;
      await flush();
      setActive(viewId);
      applyRef.current(workingDefinition(view));
    },
    [flush, setActive]
  );

  const saveChanges = useCallback(async () => {
    const view = viewsRef.current.find((v) => v.view_id === activeIdRef.current);
    if (!view?.draft) return;
    stage({ ...view, definition: view.draft, draft: null });
    await flush();
  }, [stage, flush]);

  const revert = useCallback(async () => {
    const view = viewsRef.current.find((v) => v.view_id === activeIdRef.current);
    if (!view?.draft) return;
    const reverted = { ...view, draft: null };
    stage(reverted);
    applyRef.current(workingDefinition(reverted));
    await flush();
  }, [stage, flush]);

  const saveAs = useCallback(
    async (name: string) => {
      const from = viewsRef.current.find((v) => v.view_id === activeIdRef.current);
      if (!from) return;
      await flush();
      const created = await write({
        view_id: "",
        location_id: locationId,
        name,
        is_default: false,
        position: 0,
        definition: from.draft ?? from.definition,
        draft: null,
      });
      // The edits went into the new view, so the one they came from is as saved
      if (from.draft) {
        const restored = { ...from, draft: null };
        await write(restored);
        setViews([...viewsRef.current.map((v) => (v.view_id === from.view_id ? restored : v)), created]);
      } else {
        setViews([...viewsRef.current, created]);
      }
      setActive(created.view_id);
    },
    [locationId, flush, write, setViews, setActive]
  );

  const rename = useCallback(
    async (viewId: string, name: string) => {
      const view = viewsRef.current.find((v) => v.view_id === viewId);
      if (!view) return;
      await flush();
      const saved = await write({ ...view, name });
      setViews(viewsRef.current.map((v) => (v.view_id === viewId ? saved : v)));
    },
    [flush, write, setViews]
  );

  const remove = useCallback(
    async (viewId: string) => {
      await flush();
      await deleteLocationView(viewId);
      const rest = viewsRef.current.filter((v) => v.view_id !== viewId);
      setViews(rest);
      if (activeIdRef.current === viewId) {
        const fallback = rest.find((v) => v.is_default);
        if (fallback) {
          setActive(fallback.view_id);
          applyRef.current(workingDefinition(fallback));
        }
      }
    },
    [flush, setViews, setActive]
  );

  const reload = useCallback(async () => {
    await flush();
    const list = await getLocationViews(locationId);
    setViews(list);
  }, [locationId, flush, setViews]);

  return {
    views,
    active,
    edited: !!active && !active.is_default && active.draft != null,
    record,
    select,
    saveChanges,
    revert,
    saveAs,
    rename,
    remove,
    flush,
    reload,
  };
}
