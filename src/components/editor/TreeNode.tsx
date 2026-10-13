import { useState } from "react";
import type { ViewNode, Property } from "../../types";
import {
  createViewNode,
  deleteViewNode,
  reorderViewNodes,
} from "../../lib/commands";
import PropertyPicker from "./PropertyPicker";

interface TreeNodeProps {
  node: ViewNode;
  depth: number;
  siblings: ViewNode[];
  allNodes: ViewNode[];
  library: string | null;
  onRefresh: () => void;
  isHighlighted?: boolean;
}

type Inline = "add-layer" | "add-fork" | "delete" | null;

export default function TreeNode({
  node,
  depth,
  siblings,
  allNodes,
  library,
  onRefresh,
  isHighlighted,
}: TreeNodeProps) {
  const [inline, setInline] = useState<Inline>(null);
  const [forkValue, setForkValue] = useState("");
  const [hovered, setHovered] = useState(false);

  const children = allNodes
    .filter((n) => n.parent_node_id === node.node_id)
    .sort((a, b) => a.sort_order - b.sort_order);

  const myIndex = siblings.findIndex((s) => s.node_id === node.node_id);
  const maxChildSort = children.length > 0 ? Math.max(...children.map((c) => c.sort_order)) : -1;

  async function moveUp() {
    if (myIndex <= 0) return;
    const prev = siblings[myIndex - 1];
    await reorderViewNodes([
      { nodeId: node.node_id, sortOrder: prev.sort_order },
      { nodeId: prev.node_id, sortOrder: node.sort_order },
    ]);
    onRefresh();
  }

  async function moveDown() {
    if (myIndex >= siblings.length - 1) return;
    const next = siblings[myIndex + 1];
    await reorderViewNodes([
      { nodeId: node.node_id, sortOrder: next.sort_order },
      { nodeId: next.node_id, sortOrder: node.sort_order },
    ]);
    onRefresh();
  }

  async function handleAddLayer(prop: Property) {
    await createViewNode(node.view_id, node.node_id, prop.property_id, null, maxChildSort + 1);
    setInline(null);
    onRefresh();
  }

  async function handleAddFork(prop: Property) {
    const value = forkValue.trim();
    if (!value) return;
    const nextSort = siblings.length > 0 ? Math.max(...siblings.map((s) => s.sort_order)) + 1 : 0;
    await createViewNode(node.view_id, node.parent_node_id, prop.property_id, value, nextSort);
    setInline(null);
    setForkValue("");
    onRefresh();
  }

  async function handleDelete() {
    await deleteViewNode(node.node_id);
    setInline(null);
    onRefresh();
  }

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 pr-2 rounded group ${
          isHighlighted ? "bg-neutral-700/50" : "hover:bg-neutral-800/60"
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Fork badge */}
        {node.fork_value && (
          <span className="text-xs text-neutral-400 font-mono mr-1">▸ {node.fork_value}</span>
        )}

        {/* Property name */}
        <span className="flex-1 text-xs text-neutral-200 truncate">{node.property_name}</span>

        {/* Actions — shown on hover */}
        {(hovered || inline !== null) && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={moveUp}
              disabled={myIndex <= 0}
              title="Move up"
              className="w-5 h-5 flex items-center justify-center text-neutral-500 hover:text-neutral-300 disabled:opacity-30 text-xs"
            >
              ↑
            </button>
            <button
              onClick={moveDown}
              disabled={myIndex >= siblings.length - 1}
              title="Move down"
              className="w-5 h-5 flex items-center justify-center text-neutral-500 hover:text-neutral-300 disabled:opacity-30 text-xs"
            >
              ↓
            </button>
            <button
              onClick={() => setInline(inline === "add-layer" ? null : "add-layer")}
              title="Add layer below"
              className="w-5 h-5 flex items-center justify-center text-neutral-500 hover:text-neutral-300 text-xs"
            >
              ⬇
            </button>
            <button
              onClick={() => setInline(inline === "add-fork" ? null : "add-fork")}
              title="Add fork"
              className="w-5 h-5 flex items-center justify-center text-neutral-500 hover:text-neutral-300 text-xs"
            >
              ⑂
            </button>
            <button
              onClick={() => setInline(inline === "delete" ? null : "delete")}
              title="Delete node"
              className="w-5 h-5 flex items-center justify-center text-neutral-500 hover:text-red-400 text-xs"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Inline: Add layer */}
      {inline === "add-layer" && (
        <div className="relative" style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}>
          <span className="text-xs text-neutral-400 italic">Select property for new layer:</span>
          <PropertyPicker
            library={library}
            onSelect={handleAddLayer}
            onClose={() => setInline(null)}
          />
        </div>
      )}

      {/* Inline: Add fork */}
      {inline === "add-fork" && (
        <div
          className="flex flex-col gap-1 py-1 pr-2"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <span className="text-xs text-neutral-400 italic">Branch for value:</span>
          <div className="relative flex gap-1">
            <input
              autoFocus
              value={forkValue}
              onChange={(e) => setForkValue(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setInline(null)}
              placeholder="e.g. Photos"
              className="flex-1 bg-neutral-700 text-neutral-100 text-xs px-2 py-1 rounded border border-neutral-600 focus:outline-none focus:border-neutral-400"
            />
          </div>
          {forkValue.trim() && (
            <div className="relative">
              <span className="text-xs text-neutral-400 italic">Property for this branch:</span>
              <PropertyPicker
                library={library}
                onSelect={handleAddFork}
                onClose={() => setInline(null)}
              />
            </div>
          )}
        </div>
      )}

      {/* Inline: Delete confirmation */}
      {inline === "delete" && (
        <div
          className="flex items-center gap-2 py-1 pr-2 bg-neutral-800 rounded"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <span className="text-xs text-neutral-300 flex-1">
            Remove layer? No file data will change.
          </span>
          <button
            onClick={handleDelete}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5 rounded border border-red-800 hover:border-red-600 transition-colors"
          >
            Remove
          </button>
          <button
            onClick={() => setInline(null)}
            className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Children */}
      {children.map((child) => (
        <TreeNode
          key={child.node_id}
          node={child}
          depth={depth + 1}
          siblings={children}
          allNodes={allNodes}
          library={library}
          onRefresh={onRefresh}
          isHighlighted={isHighlighted}
        />
      ))}
    </div>
  );
}
