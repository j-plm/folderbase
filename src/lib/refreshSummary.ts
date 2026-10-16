/** What a location refresh changed (mirrors SyncSummary in src-tauri/src/commands/sync.rs). */
export interface RefreshSummary {
  added: number;
  updated: number;
  moved: number;
  removed: number;
}

/** "3 added, 1 moved, 2 removed", or "Up to date" when nothing changed. */
export function describeRefresh(s: RefreshSummary): string {
  const parts = [
    s.added && `${s.added.toLocaleString()} added`,
    s.updated && `${s.updated.toLocaleString()} updated`,
    s.moved && `${s.moved.toLocaleString()} moved`,
    s.removed && `${s.removed.toLocaleString()} removed`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Up to date";
}
