import { useEffect, useRef, useState } from "react";
import {
  getFolderTree,
  getMappingNodes,
  type FolderTreeNode,
  type PathMappingNode,
} from "../../lib/commands";
import FolderBrowserEditor from "./FolderBrowserEditor";

const WIDTH_KEY = "mapping-panel-width";
const MIN_WIDTH = 420;
const DEFAULT_WIDTH = 640;

function storedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= MIN_WIDTH ? n : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

interface Props {
  locationId: string;
  locationName?: string;
  onClose: () => void;
}

export default function PathMappingPanel({ locationId, locationName, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [tree, setTree] = useState<FolderTreeNode | null>(null);
  const [mappings, setMappings] = useState<PathMappingNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(storedWidth);
  const panelRef = useRef<HTMLDivElement>(null);

  // Drag the left edge to resize; the panel can grow to nearly the full pane.
  // Mouse events, not pointer events: after a native menu closes WebKit can still
  // think the button is down and skip the next pointerdown, so the first click did nothing
  function startResize(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const maxWidth = (panelRef.current?.parentElement?.clientWidth ?? window.innerWidth) - 40;
    let latest = startWidth;
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + startX - ev.clientX));
      setWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      try {
        localStorage.setItem(WIDTH_KEY, String(latest));
      } catch {
        // ignore
      }
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    Promise.all([getFolderTree(locationId), getMappingNodes(locationId)])
      .then(([treeData, mappingData]) => {
        setTree(treeData);
        setMappings(mappingData);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    return () => clearTimeout(t);
  }, [locationId]);

  return (
    <div
      ref={panelRef}
      style={{ width, maxWidth: "calc(100% - 40px)" }}
      className={`absolute right-0 top-0 h-full flex flex-col bg-neutral-900 border-l border-neutral-700/60 shadow-2xl z-50 transition-transform duration-300 ${
        visible ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div
        onMouseDown={startResize}
        className="absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize z-10"
        aria-hidden
      />

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-700/60 shrink-0">
        <div>
          <h2 className="text-sm font-medium text-neutral-100">Map Folder Structure</h2>
          {locationName && (
            <p className="text-xs text-neutral-500 mt-0.5 truncate max-w-[400px]">{locationName}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            Loading…
          </div>
        )}
        {error && (
          <div className="px-5 py-3 text-red-400 text-xs">{error}</div>
        )}
        {!loading && !error && tree && tree.children.length === 0 && (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            No folders found — index the location first.
          </div>
        )}
        {!loading && !error && tree && tree.children.length > 0 && (
          <FolderBrowserEditor
            locationId={locationId}
            rootNode={tree}
            initialMappings={mappings}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-neutral-700/60 shrink-0 flex items-center justify-end">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded border border-neutral-700 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
