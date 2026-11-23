import { useEffect, useState } from "react";
import { useActivities, useActivityControls } from "../../contexts/ActivityContext";
import { activityLine } from "../../lib/activity";
import { getLocations, stopRefresh } from "../../lib/commands";
import { FolderIcon, SymbolIcon } from "../../lib/fileIcons";
import { ProgressBar } from "../shared/Progress";
import { NOTICE_CLASS, PushButton } from "./Notice";

/**
 * A notice per location that's busy, in the same corner stack as zips, laid out
 * as their macOS notification banner: the location's folder icon, a bold line
 * ("Looking for files in “Documents”…", "Copying 3 items to “Documents”"), a grey
 * one under it ("1,240 files found", "45.2 MB of 1.2 GB — Talk.m4a"), the bar,
 * and Stop while a refresh can stop. When it's done it says how it went for a
 * few seconds; hovering keeps it, and the close button shows at the top left.
 */
export default function ActivityNotices() {
  const activities = useActivities();
  const { dismiss, keep } = useActivityControls();
  const ids = Object.keys(activities);
  const names = useLocationNames(ids);
  return (
    <>
      {ids.map((id) => {
        const activity = activities[id];
        const line = activityLine(activity, names[id] ?? "the location");
        const finished = !!activity.finished;
        return (
          <div key={id} role="status" aria-live="polite" onMouseEnter={() => finished && keep(id)} className={NOTICE_CLASS}>
            {finished && (
              <button
                type="button"
                aria-label="Close"
                onClick={() => dismiss(id)}
                className="absolute -left-1.5 -top-1.5 w-5 h-5 flex items-center justify-center rounded-full border border-neutral-700/60 bg-neutral-800 shadow text-neutral-400 hover:text-neutral-100 opacity-0 group-hover:opacity-100"
              >
                <SymbolIcon name="xmark" size={8} fallback={<span className="text-[9px] leading-none">✕</span>} />
              </button>
            )}
            <FolderIcon size={32} />
            <div className="flex-1 min-w-0">
              <div className={`truncate font-semibold ${line.tone === "error" ? "text-red-400" : "text-neutral-100"}`}>{line.title}</div>
              {line.tone === "working" && <ProgressBar fraction={line.fraction} className="mt-1.5 h-1" />}
              {line.detail && (
                <div className={`text-neutral-400 ${line.tone === "error" ? "break-words" : "truncate"}`} title={line.detail}>
                  {line.detail}
                </div>
              )}
            </div>
            {line.stoppable && <PushButton onClick={() => void stopRefresh(id)}>Stop</PushButton>}
          </div>
        );
      })}
    </>
  );
}

/** The names of the locations `ids`, looked up again when one isn't known. */
function useLocationNames(ids: string[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const missing = ids.some((id) => !(id in names));
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    getLocations()
      .then((locations) => {
        if (!cancelled) setNames(Object.fromEntries(locations.map((l) => [l.location_id, l.name])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [missing]);
  return names;
}
