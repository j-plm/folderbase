import { useState, useRef, useEffect } from "react";
import { useNavigation } from "../../contexts/NavigationContext";
import { renameView } from "../../lib/commands";
import ViewTree from "./ViewTree";

export default function LocalViewEditor() {
  const {
    activeViewId,
    viewNodes,
    path,
    currentLibrary,
    views,
    refreshViewNodes,
    refreshViews,
    setEditHierarchy,
  } = useNavigation();

  const [showFullTree, setShowFullTree] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  const activeView = views.find((v) => v.view_id === activeViewId);

  // Walk path through nodes to find the node_id at the current depth
  function findCurrentNodeId(): string | null {
    if (!activeViewId || viewNodes.length === 0) return null;
    let parentId: string | null = null;
    for (const _segment of path) {
      const children = viewNodes.filter((n) => n.parent_node_id === parentId);
      // Fork-aware: prefer a node whose fork_value matches the previous segment,
      // otherwise take the first node with no fork_value.
      const node = children.find((n) => n.fork_value === null) ?? children[0];
      if (!node) return parentId;
      parentId = node.node_id;
    }
    return parentId;
  }

  const currentNodeId = findCurrentNodeId();

  // In subtree mode we want children of the current node; in full tree we show all.
  const rootNodeId: string | null = showFullTree ? null : currentNodeId;
  const highlightNodeId: string | null = showFullTree ? currentNodeId : null;

  async function handleRename() {
    const name = renameName.trim();
    if (name && activeViewId) {
      await renameView(activeViewId, name);
      await refreshViews();
    }
    setRenaming(false);
    setRenameName("");
  }

  if (!activeViewId) return null;

  return (
    <div className="flex flex-col w-72 shrink-0 border-l border-neutral-700/60 bg-neutral-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-11 border-b border-neutral-700/60 shrink-0">
        <span className="flex-1 text-xs font-medium text-neutral-300 truncate">
          {activeView?.name ?? "Edit Hierarchy"}
        </span>
        <button
          onClick={() => setEditHierarchy(false)}
          title="Close"
          className="w-5 h-5 flex items-center justify-center text-neutral-500 hover:text-neutral-300 text-xs"
        >
          ✕
        </button>
      </div>

      {/* Scope toggle */}
      <div className="flex items-center gap-px p-2 border-b border-neutral-700/60 shrink-0">
        <button
          onClick={() => setShowFullTree(false)}
          className={`flex-1 py-1 text-xs rounded-l transition-colors ${
            !showFullTree
              ? "bg-neutral-700 text-neutral-100"
              : "text-neutral-400 hover:text-neutral-200 bg-neutral-800"
          }`}
        >
          Current level
        </button>
        <button
          onClick={() => setShowFullTree(true)}
          className={`flex-1 py-1 text-xs rounded-r transition-colors ${
            showFullTree
              ? "bg-neutral-700 text-neutral-100"
              : "text-neutral-400 hover:text-neutral-200 bg-neutral-800"
          }`}
        >
          Full tree
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        <ViewTree
          viewId={activeViewId}
          nodes={viewNodes}
          rootNodeId={rootNodeId}
          highlightNodeId={highlightNodeId ?? undefined}
          library={currentLibrary}
          onRefresh={refreshViewNodes}
        />
      </div>

      {/* Footer */}
      <div className="border-t border-neutral-700/60 px-3 py-2 shrink-0">
        {renaming ? (
          <div className="flex gap-1">
            <input
              ref={renameRef}
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              onBlur={handleRename}
              placeholder="View name"
              className="flex-1 bg-neutral-700 text-neutral-100 text-xs px-2 py-1 rounded border border-neutral-600 focus:outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => {
              setRenameName(activeView?.name ?? "");
              setRenaming(true);
            }}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Rename view…
          </button>
        )}
      </div>
    </div>
  );
}
