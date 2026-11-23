import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { appSettings, chooseZipFolder, folderName, resetZipFolder, zipFolder } from "../../lib/appSettings";
import { clearThumbnailCache, getStorageInfo } from "../../lib/commands";
import { FolderIcon } from "../../lib/fileIcons";
import { platform } from "../../lib/platform";
import { formatBytes } from "../../lib/settingsText";
import { Button, Divider, Form, PaneFooter, PopUp, Row } from "./controls";

/** Settings ▸ Files: where zips go, and the thumbnail cache. */
export default function FilesPane() {
  const state = useSyncExternalStore(appSettings.subscribe, appSettings.snapshot);
  const [cache, setCache] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  useEffect(() => void appSettings.load(), []);

  const measure = useCallback(() => {
    getStorageInfo()
      .then((info) => setCache(info.thumbnail_bytes))
      .catch(() => setCache(null));
  }, []);
  useEffect(measure, [measure]);

  async function clear() {
    setClearing(true);
    try {
      await clearThumbnailCache();
    } finally {
      setClearing(false);
      measure();
    }
  }

  const chosen = state.settings.zip_folder;
  // Downloads, the folder chosen (when there is one), then Other…
  const choices = [{ value: "downloads", label: folderName(state.downloads) }, ...(chosen ? [{ value: "chosen", label: folderName(chosen) }] : [])];

  return (
    <>
      <Form>
        <Row
          label="Save zips in"
          note={`Where Compress puts zips. Hold ${platform === "macos" ? "⌥" : "Alt"} as you right-click to choose a place each time.`}
        >
          <PopUp
            value={chosen ? "chosen" : "downloads"}
            choices={choices}
            onChange={(v) => v === "downloads" && void resetZipFolder()}
            icon={<FolderIcon size={16} />}
            title={zipFolder(state) ?? undefined}
            extra={[{ type: "item", text: "Other…", action: () => void chooseZipFolder() }]}
          />
        </Row>
        <Divider />
        <Row label="Thumbnail cache" note="Thumbnails of your files, kept so folders show quickly. They’re made again as they’re needed.">
          <div className="flex items-baseline gap-3">
            <span className="tabular-nums">{cache === null ? "—" : formatBytes(cache)}</span>
            <Button onClick={() => void clear()} disabled={clearing || cache === 0}>
              {clearing ? "Clearing…" : "Clear Cache"}
            </Button>
          </div>
        </Row>
      </Form>
      <PaneFooter onRestore={chosen ? () => void resetZipFolder() : undefined} />
    </>
  );
}
