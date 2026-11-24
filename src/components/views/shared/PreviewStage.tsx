import { useEffect, useRef, useState, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FileIcon, isImageMime } from "../../../lib/fileIcons";
import { livePreviewAvailable } from "../../../lib/platform";
import LivePreview from "./LivePreview";
import type { FileRecord } from "../../../types";

/** Largest preview icon / thumbnail edge, in points. */
const PREVIEW_MAX = 512;
/**
 * The preview area's shape, as Finder's preview column and pane: as wide as the
 * space and a page's height (A4, 1 : √2). It gives up height when space is short.
 */
const PREVIEW_ASPECT = `1 / ${Math.SQRT2}`;

/** Whether showing the file in full would download it (online-only, or on a streamed drive). */
export function wouldDownload(file: Pick<FileRecord, "online_only" | "streamed">): boolean {
  return !!(file.online_only || file.streamed);
}

interface Props {
  file: FileRecord;
  /**
   * Live where it can be: the OS's Quick Look view, scrolling PDFs and playing
   * video. There is one live view in the app, so only one stage on screen may
   * ask for it (Columns' preview column, the Preview pane, or Gallery's large
   * preview); others show the still picture.
   */
  live: boolean;
  /** Fill the space given (Gallery) rather than taking a page's shape. */
  fill?: boolean;
  /**
   * Mark the still picture as the file's icon, so Quick Look zooms out of it.
   * Columns' preview column does, as Finder's; the Preview pane leaves that to
   * the item in the view.
   */
  iconOf?: boolean;
  /** Largest picture edge, in points. */
  max?: number;
}

/**
 * The large picture of a file: live where it can be, with the still picture
 * (the image itself, or the file's icon at a size stepping with the space)
 * beneath. Selecting a file never downloads it: only opening it or Quick Look does.
 */
export default function PreviewStage({ file, live, fill = false, iconOf = false, max = PREVIEW_MAX }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setStage({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Native icons are rendered at fixed sizes; step in 32pt increments so
  // resizing doesn't request a new icon for every pixel.
  const fit = Math.min(stage.width, stage.height, max);
  const iconSize = Math.max(64, Math.floor(fit / 32) * 32);
  const downloads = wouldDownload(file);

  return (
    <>
      <div
        ref={stageRef}
        style={fill ? undefined : { aspectRatio: PREVIEW_ASPECT }}
        className={fill ? "relative flex-1 min-h-0" : "relative min-h-[160px] shrink-0"}
      >
        {stage.width > 0 && (
          <Stage live={live && livePreviewAvailable && !downloads} path={file.file_path}>
            {/* An online-only or streamed image would download to show in full; its icon stands in */}
            {isImageMime(file.file_type) && !downloads ? (
              <img
                src={convertFileSrc(file.file_path)}
                alt=""
                draggable={false}
                data-icon-of={iconOf ? file.file_path : undefined}
                style={{ maxWidth: fit, maxHeight: fit }}
                className="object-contain shadow-sm"
              />
            ) : (
              <FileIcon path={file.file_path} mimeType={file.file_type} size={iconSize} />
            )}
          </Stage>
        )}
      </div>
      {downloads && (
        <p className="shrink-0 mt-2 text-center text-[11px] text-neutral-500">
          {file.online_only ? "Not downloaded" : "Downloads when opened"}
        </p>
      )}
    </>
  );
}

/** Where the picture goes, filling the stage: live where it can be, the still picture beneath. */
function Stage({ live, path, children }: { live: boolean; path: string; children: ReactNode }) {
  const className = "absolute inset-0 flex items-center justify-center";
  if (!live) return <div className={className}>{children}</div>;
  return (
    <LivePreview path={path} className={className}>
      {children}
    </LivePreview>
  );
}
