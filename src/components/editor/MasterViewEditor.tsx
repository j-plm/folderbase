import { useState, useEffect, useRef } from "react";
import type { ViewNode } from "../../types";
import {
  getViewNodes,
  createView,
  renameView,
  deleteView,
  createViewNode,
} from "../../lib/commands";
import { useNavigation } from "../../contexts/NavigationContext";
import ViewTree from "./ViewTree";

export default function MasterViewEditor() {
  const { views, currentLibrary, closeMasterEditor, refreshViews, setActiveView } =
    useNavigation();

  const [selectedViewId, setSelectedViewId] = useState<string | null>(
    views[0]?.view_id ?? null
  );
  const [localNodes, setLocalNodes] = useState<ViewNode[]>([]);
  const [menuViewId, setMenuViewId] = useState<string | null>(null);
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [addingView, setAddingView] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const newViewRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMasterEditor();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeMasterEditor]);

  useEffect(() => {
    if (selectedViewId) {
      getViewNodes(selectedViewId).then(setLocalNodes).catch(() => {});
    } else {
      setLocalNodes([]);
    }
  }, [selectedViewId]);

  useEffect(() => {
    if (renamingViewId && renameRef.current) renameRef.current.focus();
  }, [renamingViewId]);

  useEffect(() => {
    if (addingView && newViewRef.current) newViewRef.current.focus();
  }, [addingView]);

  async function handleCreateView() {
    const name = newViewName.trim();
    if (!name) {
      setAddingView(false);
      setNewViewName("");
      return;
    }
    try {
      const v = await createView(name, currentLibrary);
      await refreshViews();
      setSelectedViewId(v.view_id);
    } catch {
      // ignore
    }
    setAddingView(false);
    setNewViewName("");
  }

  async function handleRename() {
    const name = renameName.trim();
    if (name && renamingViewId) {
      await renameView(renamingViewId, name);
      await refreshViews();
    }
    setRenamingViewId(null);
    setRenameName("");
  }

  async function handleDuplicate(viewId: string) {
    setMenuViewId(null);
    const source = views.find((v) => v.view_id === viewId);
    if (!source) return;
    const copy = await createView(`${source.name} (copy)`, source.library);
    const srcNodes = await getViewNodes(viewId);
    // Rebuild the tree preserving parent relationships
    const idMap = new Map<string, string>();
    const sorted = [...srcNodes].sort((a, b) => {
      if (!a.parent_node_id) return -1;
      if (!b.parent_node_id) return 1;
      return 0;
    });
    for (const n of sorted) {
      const newParent = n.parent_node_id ? (idMap.get(n.parent_node_id) ?? null) : null;
      const newNode = await createViewNode(
        copy.view_id,
        newParent,
        n.property_id,
        n.fork_value,
        n.sort_order
      );
      idMap.set(n.node_id, newNode.node_id);
    }
    await refreshViews();
    setSelectedViewId(copy.view_id);
  }

  async function handleDelete(viewId: string) {
    await deleteView(viewId);
    setDeleteConfirmId(null);
    setMenuViewId(null);
    await refreshViews();
    if (selectedViewId === viewId) {
      const remaining = views.filter((v) => v.view_id !== viewId);
      const next = remaining[0]?.view_id ?? null;
      setSelectedViewId(next);
      if (next) setActiveView(next);
    }
  }

  function refreshLocal() {
    if (selectedViewId) {
      getViewNodes(selectedViewId).then(setLocalNodes).catch(() => {});
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-neutral-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-11 border-b border-neutral-700/60 shrink-0">
        <span className="text-sm font-medium text-neutral-200 flex-1">All Views</span>
        <button
          onClick={closeMasterEditor}
          className="text-xs text-neutral-400 hover:text-neutral-200 px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 transition-colors"
        >
          Close
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left panel — view list */}
        <div className="w-56 shrink-0 border-r border-neutral-700/60 flex flex-col">
          <div className="flex-1 overflow-y-auto py-1">
            {views.map((view) => (
              <div key={view.view_id} className="relative">
                {renamingViewId === view.view_id ? (
                  <div className="px-3 py-1">
                    <input
                      ref={renameRef}
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename();
                        if (e.key === "Escape") setRenamingViewId(null);
                      }}
                      onBlur={handleRename}
                      className="w-full bg-neutral-700 text-neutral-100 text-xs px-2 py-1 rounded border border-neutral-600 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div
                    className={`flex items-center gap-1 px-3 py-1.5 cursor-pointer ${
                      selectedViewId === view.view_id
                        ? "bg-neutral-700 text-neutral-100"
                        : "text-neutral-300 hover:bg-neutral-800"
                    }`}
                    onClick={() => setSelectedViewId(view.view_id)}
                  >
                    <span className="flex-1 text-xs truncate">{view.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuViewId(menuViewId === view.view_id ? null : view.view_id);
                      }}
                      className="w-5 h-5 flex items-center justify-center text-neutral-500 hover:text-neutral-300 text-xs rounded"
                    >
                      ···
                    </button>
                  </div>
                )}

                {/* View context menu */}
                {menuViewId === view.view_id && (
                  <div className="absolute right-0 top-full z-10 w-36 bg-neutral-800 border border-neutral-600 rounded shadow-lg py-1">
                    <button
                      onClick={() => {
                        setMenuViewId(null);
                        setRenameName(view.name);
                        setRenamingViewId(view.view_id);
                      }}
                      className="w-full text-left px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => handleDuplicate(view.view_id)}
                      className="w-full text-left px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
                    >
                      Duplicate
                    </button>
                    <button
                      onClick={() => {
                        setMenuViewId(null);
                        setDeleteConfirmId(view.view_id);
                      }}
                      className="w-full text-left px-3 py-1 text-xs text-red-400 hover:bg-neutral-700"
                    >
                      Delete…
                    </button>
                  </div>
                )}

                {/* Delete confirmation */}
                {deleteConfirmId === view.view_id && (
                  <div className="px-3 py-2 bg-neutral-800 border-t border-neutral-700">
                    <p className="text-xs text-neutral-300 mb-1">
                      Delete "{view.name}"? No file data will change.
                    </p>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleDelete(view.view_id)}
                        className="flex-1 text-xs text-red-400 border border-red-800 hover:border-red-600 rounded py-0.5 transition-colors"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="flex-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add new view */}
          <div className="border-t border-neutral-700/60 p-2 shrink-0">
            {addingView ? (
              <input
                ref={newViewRef}
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateView();
                  if (e.key === "Escape") {
                    setAddingView(false);
                    setNewViewName("");
                  }
                }}
                onBlur={handleCreateView}
                placeholder="View name"
                className="w-full bg-neutral-700 text-neutral-100 text-xs px-2 py-1 rounded border border-neutral-600 focus:outline-none"
              />
            ) : (
              <button
                onClick={() => setAddingView(true)}
                className="w-full text-left text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                + New view
              </button>
            )}
          </div>
        </div>

        {/* Right panel — tree editor */}
        <div className="flex-1 overflow-y-auto py-2">
          {selectedViewId ? (
            <ViewTree
              viewId={selectedViewId}
              nodes={localNodes}
              rootNodeId={null}
              library={currentLibrary}
              onRefresh={refreshLocal}
            />
          ) : (
            <p className="text-xs text-neutral-500 px-4 py-2 italic">Select a view to edit its structure.</p>
          )}
        </div>
      </div>
    </div>
  );
}
