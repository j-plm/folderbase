import { useRef, useState } from "react";
import {
  clearFolderLabel,
  setFolderLabel,
  type FolderTreeNode,
  type PathMappingNode,
} from "../../lib/commands";

interface Props {
  node: FolderTreeNode;
  locationId: string;
  allMappings: PathMappingNode[];
  depth: number;
  onMappingChange: () => void;
}

const ACCENTS = [
  {
    border: "border-l-blue-500",
    badge: "bg-blue-500/20 text-blue-300 border border-blue-500/50",
  },
  {
    border: "border-l-emerald-500",
    badge: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50",
  },
  {
    border: "border-l-violet-500",
    badge: "bg-violet-500/20 text-violet-300 border border-violet-500/50",
  },
  {
    border: "border-l-amber-500",
    badge: "bg-amber-500/20 text-amber-300 border border-amber-500/50",
  },
  {
    border: "border-l-rose-500",
    badge: "bg-rose-500/20 text-rose-300 border border-rose-500/50",
  },
];

function accentForName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  }
  return ACCENTS[h % ACCENTS.length];
}

function getSuggestion(
  node: FolderTreeNode,
  allMappings: PathMappingNode[]
): string | null {
  if (node.mapping) return null;

  const parentPath = node.folder_path
    .replace(/\\/g, "/")
    .split("/")
    .slice(0, -1)
    .join("/");

  // Nearest labelled sibling: same depth, same parent folder
  const sibling = allMappings.find((m) => {
    const mParent = m.folder_path
      .replace(/\\/g, "/")
      .split("/")
      .slice(0, -1)
      .join("/");
    return m.depth === node.depth && mParent === parentPath;
  });
  if (sibling) return sibling.property_name;

  // Any labelled node at the same depth
  const sameDepth = allMappings.find((m) => m.depth === node.depth);
  if (sameDepth) return sameDepth.property_name;

  return null;
}

interface FolderRowProps {
  node: FolderTreeNode;
  locationId: string;
  allMappings: PathMappingNode[];
  onMappingChange: () => void;
}

function FolderRow({
  node,
  locationId,
  allMappings,
  onMappingChange,
}: FolderRowProps) {
  const [collapsed, setCollapsed] = useState(node.depth >= 2);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestion = getSuggestion(node, allMappings);
  const accent = node.mapping ? accentForName(node.mapping.property_name) : null;
  const indent = (node.depth - 1) * 20;

  async function commit(value: string) {
    const v = value.trim();
    try {
      if (v) {
        await setFolderLabel(locationId, node.folder_path, v);
      } else if (node.mapping) {
        await clearFolderLabel(locationId, node.folder_path);
      }
    } catch {
      // errors surface on next load
    }
    setEditing(false);
    setInputValue("");
    onMappingChange();
  }

  function openEditor(initial = "") {
    setInputValue(initial);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 10);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      commit(inputValue);
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit(inputValue || suggestion || "");
    } else if (e.key === "Escape") {
      setEditing(false);
      setInputValue("");
    }
  }

  return (
    <>
      <div
        className={`flex items-center gap-2 pr-3 py-1.5 border-l-2 hover:bg-neutral-800/40 transition-colors ${
          node.mapping ? accent!.border : "border-l-transparent"
        }`}
        style={{ paddingLeft: `${indent + 12}px` }}
      >
        {/* Collapse toggle */}
        {node.children.length > 0 ? (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-neutral-500 hover:text-neutral-300 text-[10px] w-4 shrink-0 text-center"
          >
            {collapsed ? "▶" : "▾"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Depth guide lines */}
        {node.depth > 1 && (
          <span
            className="absolute left-0 top-0 bottom-0 pointer-events-none"
            style={{ width: `${indent + 12}px` }}
          />
        )}

        {/* Folder icon + name */}
        <span className="font-mono text-xs text-neutral-300 flex-1 truncate select-none">
          {node.folder_name}
        </span>

        {/* File count */}
        <span className="text-[10px] text-neutral-500 shrink-0 tabular-nums">
          {node.file_count.toLocaleString()}
        </span>

        {/* Label area */}
        <div className="w-36 shrink-0">
          {editing ? (
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onBlur={() => commit(inputValue)}
              onKeyDown={handleKeyDown}
              placeholder={suggestion ?? "Label this level…"}
              className="w-full px-2 py-0.5 bg-neutral-800 border border-neutral-600 rounded text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
            />
          ) : node.mapping ? (
            <button
              onClick={() => openEditor(node.mapping!.property_name)}
              className={`w-full px-2 py-0.5 rounded text-xs truncate text-left ${accent!.badge}`}
            >
              {node.mapping.property_name}
            </button>
          ) : suggestion ? (
            <button
              onClick={() => openEditor(suggestion)}
              className="w-full px-2 py-0.5 rounded border border-dashed border-neutral-600 text-xs text-neutral-500 italic truncate text-left hover:border-neutral-500 hover:text-neutral-400 transition-colors"
            >
              {suggestion}
            </button>
          ) : (
            <button
              onClick={() => openEditor("")}
              className="w-full px-2 py-0.5 rounded text-xs text-neutral-500 text-left hover:text-neutral-500 transition-colors"
            >
              Label this level…
            </button>
          )}
        </div>
      </div>

      {!collapsed &&
        node.children.map((child) => (
          <FolderRow
            key={child.folder_path}
            node={child}
            locationId={locationId}
            allMappings={allMappings}
            onMappingChange={onMappingChange}
          />
        ))}
    </>
  );
}

export default function TreeEditor({
  node,
  locationId,
  allMappings,
  onMappingChange,
}: Props) {
  // Root node (depth 0) is the location itself — render only its children
  return (
    <div className="py-1">
      {node.children.map((child) => (
        <FolderRow
          key={child.folder_path}
          node={child}
          locationId={locationId}
          allMappings={allMappings}
          onMappingChange={onMappingChange}
        />
      ))}
    </div>
  );
}
