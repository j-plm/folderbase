import { useEffect, useState } from "react";
import {
  getFolderTree,
  getMappingNodes,
  type FolderTreeNode,
  type PathMappingNode,
} from "../../lib/commands";
import FolderBrowserEditor from "./FolderBrowserEditor";

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
      className={`absolute right-0 top-0 h-full w-[640px] flex flex-col bg-neutral-900 border-l border-neutral-700/60 shadow-2xl z-50 transition-transform duration-300 ${
        visible ? "translate-x-0" : "translate-x-full"
      }`}
    >
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
