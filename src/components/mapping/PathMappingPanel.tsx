import { useEffect, useState } from "react";
import {
  getFolderTree,
  getMappingNodes,
  type FolderTreeNode,
  type PathMappingNode,
} from "../../lib/commands";
import SidePanel from "../shared/SidePanel";
import FolderBrowserEditor from "./FolderBrowserEditor";

interface Props {
  locationId: string;
  locationName?: string;
  onClose: () => void;
}

export default function PathMappingPanel({ locationId, locationName, onClose }: Props) {
  const [tree, setTree] = useState<FolderTreeNode | null>(null);
  const [mappings, setMappings] = useState<PathMappingNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getFolderTree(locationId), getMappingNodes(locationId)])
      .then(([treeData, mappingData]) => {
        setTree(treeData);
        setMappings(mappingData);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [locationId]);

  return (
    <SidePanel title="Map Disk Folders" subtitle={locationName} widthKey="mapping-panel-width" onClose={onClose} closeOnOutsideClick>
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
    </SidePanel>
  );
}
