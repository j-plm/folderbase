import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import InfoPanel from "../info/InfoPanel";
import { getSelectedPaths, onSelectedPaths } from "../../lib/selectionStatus";
import { PREVIEW_WIDTH_KEY } from "../../lib/previewPane";
import type { FileRecord } from "../../types";

const MIN_WIDTH = 220;
const DEFAULT_WIDTH = 280;

function storedWidth(): number {
  try {
    const n = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
    return n >= MIN_WIDTH ? n : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** The selected files (reported by whichever view is showing), as records of the location's files. */
export function useSelectedFiles(files: FileRecord[]): FileRecord[] {
  const [paths, setPaths] = useState(getSelectedPaths);
  useEffect(() => {
    setPaths(getSelectedPaths());
    return onSelectedPaths(setPaths);
  }, []);
  return useMemo(() => {
    const byPath = new Map(files.map((f) => [f.file_path, f]));
    return paths.flatMap((p) => byPath.get(p) ?? []);
  }, [files, paths]);
}

interface Props {
  files: FileRecord[];
  /** Live for one file; Gallery's pane shows a still picture, its large preview holding the one live view. */
  preview: "live" | "still";
}

/**
 * View ▸ Show Preview (⇧⌘P): Finder's preview pane at the right of Icons, List,
 * the Database view and Gallery (spec ▸ Preview Pane). It shows the selection
 * (in the Database view, the rows holding selected cells), editable. Drag its
 * left edge to resize. Arrow keys pressed in it still move through the view.
 */
export default function PreviewPane({ files, preview }: Props) {
  const selected = useSelectedFiles(files);
  const [width, setWidth] = useState(storedWidth);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const max = Math.max(MIN_WIDTH, window.innerWidth / 2);
    let latest = startWidth;
    const move = (ev: PointerEvent) => {
      latest = Math.min(max, Math.max(MIN_WIDTH, startWidth + startX - ev.clientX));
      setWidth(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(PREVIEW_WIDTH_KEY, String(Math.round(latest)));
      } catch {
        // Only a convenience
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside
      data-keys-to-browse
      aria-label="Preview"
      style={{ width }}
      className="relative shrink-0 h-full border-l border-neutral-700/60 bg-neutral-900"
    >
      <div onPointerDown={startResize} className="absolute inset-y-0 -left-[3px] w-[6px] cursor-col-resize z-10" />
      <div className="h-full overflow-y-auto px-5 pt-5 pb-8">
        {selected.length === 0 ? (
          <div className="h-full flex items-center justify-center text-neutral-500 select-none">No Selection</div>
        ) : (
          <InfoPanel files={selected} preview={selected.length === 1 ? preview : "none"} />
        )}
      </div>
    </aside>
  );
}
