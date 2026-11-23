import { useEffect, useState } from "react";
import { getStorageInfo, resetAppSettings, revealPaths, type StorageInfo } from "../../lib/commands";
import { labels } from "../../lib/platform";
import { confirmAction, refreshAllLocations } from "../../lib/settingsActions";
import { formatBytes } from "../../lib/settingsText";
import { Button, Divider, Form, Row } from "./controls";

/** Settings ▸ Advanced: the database, rebuilding the index, and resetting every setting. */
export default function AdvancedPane() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  /** Rebuild Index's progress: locations done of how many. */
  const [rebuilding, setRebuilding] = useState<{ done: number; total: number } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const measure = () => void getStorageInfo().then(setInfo).catch(() => {});
  useEffect(measure, []);

  async function rebuild() {
    const ok = await confirmAction(
      "Rebuild the index?",
      "Every location’s files are read again from disk. Values you’ve given files are kept. This can take a while for large locations.",
      "Rebuild Index"
    );
    if (!ok) return;
    setProblems([]);
    setRebuilding({ done: 0, total: 0 });
    const errors = await refreshAllLocations((done, total) => setRebuilding({ done, total }));
    setRebuilding(null);
    setProblems(errors);
    measure();
  }

  async function resetAll() {
    const ok = await confirmAction(
      "Reset all settings?",
      "Every setting goes back to how it was when Folderbase was installed, Appearance included. Your locations, views and values aren’t touched.",
      "Reset All Settings",
      true
    );
    if (!ok) return;
    // Every window, this one included, hears the settings as they now are
    await resetAppSettings();
  }

  return (
    <Form>
      <Row label="Database" note="Where Folderbase keeps your properties, values and views. Your files stay where they are.">
        <span className="max-w-[400px] truncate select-text cursor-text" title={info?.database_path}>
          {info?.database_path ?? "—"}
        </span>
        <div className="flex items-baseline gap-3">
          <span className="tabular-nums text-neutral-400">{info ? formatBytes(info.database_bytes) : ""}</span>
          <Button onClick={() => info && void revealPaths([info.database_path])} disabled={!info}>
            {labels.reveal}
          </Button>
        </div>
      </Row>
      <Divider />
      <Row label="Index" note="Reads every location’s files again. Values you’ve given files are kept.">
        <div className="flex items-baseline gap-3">
          <Button onClick={() => void rebuild()} disabled={!!rebuilding}>
            Rebuild Index…
          </Button>
          {rebuilding && (
            <span className="text-neutral-400 tabular-nums">
              {rebuilding.total ? `Rebuilding ${Math.min(rebuilding.done + 1, rebuilding.total)} of ${rebuilding.total}…` : "Rebuilding…"}
            </span>
          )}
        </div>
        {problems.length > 0 && (
          <div className="text-[11px] text-red-500">
            {problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        )}
      </Row>
      <Divider />
      <Row label="Settings" note="Every setting back to its default. Locations and views are untouched.">
        <Button onClick={() => void resetAll()} destructive>
          Reset All Settings…
        </Button>
      </Row>
    </Form>
  );
}
