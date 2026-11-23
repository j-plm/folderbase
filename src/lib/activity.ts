import { formatFinderSize } from "./arrange";
import { describeRefresh, type RefreshSummary } from "./refreshSummary";

// What a location is busy with (a refresh, files being copied in), and how it
// reads in its progress bar. Mirrors SyncProgress and CopyProgress in
// src-tauri/src/commands/sync.rs and import.rs.

/** A refresh's stage: listing has no total yet; saving can't be stopped. */
export type SyncProgress =
  | { phase: "listing"; found: number }
  | { phase: "reading"; done: number; total: number }
  | { phase: "saving" };

export interface CopyProgress {
  files_done: number;
  files_total: number;
  bytes_done: number;
  bytes_total: number;
  /** The file being copied. */
  name: string;
}

export type Activity =
  | {
      kind: "refresh";
      progress: SyncProgress | null;
      finished?: { summary: RefreshSummary | null; error: string | null; stopped: boolean };
    }
  | { kind: "copy"; progress: CopyProgress | null; finished?: { error: string | null } };

/** How an activity reads: a line, a smaller line under it, and the bar. */
export interface ActivityLine {
  title: string;
  detail: string | null;
  /** 0–1, or null while the total isn't known (the bar moves without filling). */
  fraction: number | null;
  /** Whether Stop is offered. */
  stoppable: boolean;
  tone: "working" | "done" | "error";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Finder's wording: "Copying 3 items to “Documents”", "45.2 MB of 1.2 GB". */
export function activityLine(activity: Activity, locationName: string): ActivityLine {
  const where = `“${locationName}”`;
  if (activity.kind === "refresh") {
    const done = activity.finished;
    if (done) {
      if (done.stopped) return { title: "Refresh stopped", detail: "Nothing was changed", fraction: null, stoppable: false, tone: "done" };
      if (done.error) return { title: `Couldn’t refresh ${where}`, detail: done.error, fraction: null, stoppable: false, tone: "error" };
      return {
        title: `Refreshed ${where}`,
        detail: done.summary ? describeRefresh(done.summary) : null,
        fraction: 1,
        stoppable: false,
        tone: "done",
      };
    }
    const p = activity.progress;
    if (!p) return { title: `Refreshing ${where}…`, detail: null, fraction: null, stoppable: true, tone: "working" };
    switch (p.phase) {
      case "listing":
        return { title: `Looking for files in ${where}…`, detail: `${plural(p.found, "file")} found`, fraction: null, stoppable: true, tone: "working" };
      case "reading":
        return p.total === 0
          ? { title: `Checking ${where}…`, detail: null, fraction: null, stoppable: true, tone: "working" }
          : {
              title: `Reading new and changed files in ${where}…`,
              detail: `${p.done.toLocaleString()} of ${plural(p.total, "file")}`,
              fraction: p.done / p.total,
              stoppable: true,
              tone: "working",
            };
      case "saving":
        return { title: `Saving changes to ${where}…`, detail: null, fraction: null, stoppable: false, tone: "working" };
    }
  }
  if (activity.finished?.error) {
    return { title: `Couldn’t copy to ${where}`, detail: activity.finished.error, fraction: null, stoppable: false, tone: "error" };
  }
  const p = activity.progress;
  if (!p || p.files_total === 0) return { title: `Copying to ${where}…`, detail: null, fraction: null, stoppable: false, tone: "working" };
  if (p.files_done >= p.files_total || activity.finished) {
    return { title: `Adding ${plural(p.files_total, "item")} to ${where}…`, detail: null, fraction: null, stoppable: false, tone: "working" };
  }
  const fraction = p.bytes_total > 0 ? p.bytes_done / p.bytes_total : p.files_done / p.files_total;
  return {
    title: `Copying ${plural(p.files_total, "item")} to ${where}`,
    detail: `${formatFinderSize(p.bytes_done)} of ${formatFinderSize(p.bytes_total)}${p.name ? ` — ${p.name}` : ""}`,
    fraction: Math.min(1, fraction),
    stoppable: false,
    tone: "working",
  };
}
