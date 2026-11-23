import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Activity, CopyProgress, SyncProgress } from "../lib/activity";
import type { RefreshSummary } from "../lib/refreshSummary";

// What each location is busy with, from the backend's progress events: a refresh
// (`indexing_progress`) or files being copied in (`copy_progress`). The notices
// in the window's bottom corner (ActivityNotices) and the sidebar's pie read it.

/** How long a finished activity stays up, saying how it went. */
const SHOW_FINISHED_MS = 3000;
const SHOW_ERROR_MS = 8000;

interface IndexingEvent {
  location_id: string;
  done: boolean;
  progress?: SyncProgress;
  summary?: RefreshSummary | null;
  error?: string | null;
  stopped?: boolean;
}

interface CopyEvent {
  location_id: string;
  done: boolean;
  progress?: CopyProgress;
  error?: string | null;
}

interface ActivityContextValue {
  activities: Record<string, Activity>;
  /** Takes a finished notice away now (its close button). */
  dismiss: (locationId: string) => void;
  /** Keeps a finished notice up until it's closed (hovered, as a zip's is). */
  keep: (locationId: string) => void;
}

const ActivityContext = createContext<ActivityContextValue>({ activities: {}, dismiss: () => {}, keep: () => {} });

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Record<string, Activity>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const keep = useCallback((id: string) => clearTimeout(timers.current.get(id)), []);
  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    setActivities((prev) => {
      if (!prev[id]?.finished) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    const pending = timers.current;
    const set = (id: string, activity: Activity | null, clearAfter?: number) => {
      clearTimeout(pending.get(id));
      setActivities((prev) => {
        const next = { ...prev };
        if (activity) next[id] = activity;
        else delete next[id];
        return next;
      });
      if (activity && clearAfter !== undefined) {
        pending.set(
          id,
          setTimeout(() => {
            // Only if nothing has started there since
            setActivities((prev) => {
              if (prev[id] !== activity) return prev;
              const next = { ...prev };
              delete next[id];
              return next;
            });
          }, clearAfter)
        );
      }
    };

    const indexing = listen<IndexingEvent>("indexing_progress", ({ payload: p }) => {
      if (!p.done) {
        set(p.location_id, { kind: "refresh", progress: p.progress ?? null });
        return;
      }
      const finished = { summary: p.summary ?? null, error: p.error ?? null, stopped: !!p.stopped };
      set(p.location_id, { kind: "refresh", progress: null, finished }, finished.error ? SHOW_ERROR_MS : SHOW_FINISHED_MS);
    });
    const copying = listen<CopyEvent>("copy_progress", ({ payload: p }) => {
      if (!p.done) {
        set(p.location_id, { kind: "copy", progress: p.progress ?? null });
      } else if (p.error) {
        set(p.location_id, { kind: "copy", progress: null, finished: { error: p.error } }, SHOW_ERROR_MS);
      } else {
        // The drop's own sheet or notice takes it from here
        set(p.location_id, null);
      }
    });
    return () => {
      void indexing.then((off) => off());
      void copying.then((off) => off());
      pending.forEach(clearTimeout);
    };
  }, []);

  const value = useMemo(() => ({ activities, dismiss, keep }), [activities, dismiss, keep]);
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

/** What every location is busy with, by location id. */
export function useActivities(): Record<string, Activity> {
  return useContext(ActivityContext).activities;
}

/** Closing and keeping finished notices. */
export function useActivityControls(): Pick<ActivityContextValue, "dismiss" | "keep"> {
  const { dismiss, keep } = useContext(ActivityContext);
  return { dismiss, keep };
}

/** What the location is busy with, if anything (finished ones stay a few seconds). */
export function useActivity(locationId: string | null | undefined): Activity | undefined {
  const { activities } = useContext(ActivityContext);
  return locationId ? activities[locationId] : undefined;
}
