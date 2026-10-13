import { useState } from "react";
import type { ViewNode, Property } from "../../types";
import { createViewNode } from "../../lib/commands";
import TreeNode from "./TreeNode";
import PropertyPicker from "./PropertyPicker";

interface ViewTreeProps {
  viewId: string;
  nodes: ViewNode[];
  rootNodeId?: string | null;
  highlightNodeId?: string | null;
  library: string | null;
  onRefresh: () => void;
}

export default function ViewTree({
  viewId,
  nodes,
  rootNodeId = null,
  highlightNodeId,
  library,
  onRefresh,
}: ViewTreeProps) {
  const [addingRoot, setAddingRoot] = useState(false);

  // Determine the set of root nodes to render
  const rootNodes = nodes
    .filter((n) => n.parent_node_id === rootNodeId)
    .sort((a, b) => a.sort_order - b.sort_order);

  const nextSort = rootNodes.length > 0 ? Math.max(...rootNodes.map((n) => n.sort_order)) + 1 : 0;

  async function handleAddRootLayer(prop: Property) {
    await createViewNode(viewId, rootNodeId ?? null, prop.property_id, null, nextSort);
    setAddingRoot(false);
    onRefresh();
  }

  return (
    <div className="text-sm">
      {rootNodes.length === 0 && !addingRoot && (
        <p className="text-xs text-neutral-500 px-3 py-2 italic">No layers configured.</p>
      )}

      {rootNodes.map((node) => (
        <TreeNode
          key={node.node_id}
          node={node}
          depth={0}
          siblings={rootNodes}
          allNodes={nodes}
          library={library}
          onRefresh={onRefresh}
          isHighlighted={node.node_id === highlightNodeId}
        />
      ))}

      {/* Add root layer */}
      <div className="relative px-2 pt-1">
        {addingRoot ? (
          <PropertyPicker
            library={library}
            onSelect={handleAddRootLayer}
            onClose={() => setAddingRoot(false)}
          />
        ) : (
          <button
            onClick={() => setAddingRoot(true)}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            + Add layer
          </button>
        )}
      </div>
    </div>
  );
}
