import { useEffect, useRef, useState } from "react";
import type React from "react";
import { listSubfolders, type Subfolder } from "../../lib/commands";
import { FolderIcon, SymbolIcon } from "../../lib/fileIcons";

const ROW_HEIGHT = 22;
const INDENT = 16;

type Listing = Subfolder[] | "loading" | { error: string };

interface Props {
  rootPath: string;
  /** Folders left out (absolute paths); their contents are never scanned. */
  excluded: Set<string>;
  /** Leave out (`exclude`) or include every folder in `paths`. */
  onSetExcluded: (paths: string[], exclude: boolean) => void;
}

/**
 * The folders inside a location, ticked to include and unticked to leave out.
 * Folders are listed one level at a time as they're expanded, so a huge drive
 * (or a cloud folder) is never walked just to show this.
 */
export default function FolderChecklist({ rootPath, excluded, onSetExcluded }: Props) {
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** The last folder clicked; shift-click applies its new state to every row between. */
  const anchor = useRef<string | null>(null);

  function load(path: string) {
    setListings((prev) => ({ ...prev, [path]: "loading" }));
    listSubfolders(path)
      .then((folders) => setListings((prev) => ({ ...prev, [path]: folders })))
      .catch((e) => setListings((prev) => ({ ...prev, [path]: { error: String(e) } })));
  }

  useEffect(() => {
    setListings({});
    setExpanded(new Set());
    anchor.current = null;
    load(rootPath);
  }, [rootPath]);

  function toggleExpanded(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!listings[path]) load(path);
      }
      return next;
    });
  }

  /** Folder paths in the order they're currently shown, skipping collapsed contents. */
  function visibleRows(path: string, out: string[] = []): string[] {
    const listing = listings[path];
    if (!Array.isArray(listing)) return out;
    for (const folder of listing) {
      out.push(folder.path);
      if (expanded.has(folder.path) && !excluded.has(folder.path)) visibleRows(folder.path, out);
    }
    return out;
  }

  function handleClick(path: string, shiftKey: boolean) {
    const exclude = !excluded.has(path);
    const rows = visibleRows(rootPath);
    const from = anchor.current ? rows.indexOf(anchor.current) : -1;
    const to = rows.indexOf(path);
    if (shiftKey && from !== -1 && to !== -1) {
      onSetExcluded(rows.slice(Math.min(from, to), Math.max(from, to) + 1), exclude);
    } else {
      onSetExcluded([path], exclude);
    }
    anchor.current = path;
  }

  function renderLevel(path: string, depth: number): React.ReactNode {
    const listing = listings[path];
    const note = (text: string) => (
      <div style={{ height: ROW_HEIGHT, paddingLeft: 8 + depth * INDENT + 18 }} className="flex items-center text-xs text-neutral-500">
        {text}
      </div>
    );
    if (!listing || listing === "loading") return note("Reading folders…");
    if ("error" in listing) return note(listing.error);
    if (listing.length === 0) return depth === 0 ? note("No subfolders. Everything here will be indexed.") : null;
    return listing.map((folder) => {
      const isExcluded = excluded.has(folder.path);
      const isOpen = expanded.has(folder.path) && !isExcluded;
      return (
        <div key={folder.path}>
          <div style={{ height: ROW_HEIGHT, paddingLeft: 4 + depth * INDENT }} className="flex items-center gap-1 pr-2">
            <button
              type="button"
              aria-label={isOpen ? "Collapse" : "Expand"}
              disabled={isExcluded}
              onClick={() => toggleExpanded(folder.path)}
              className="w-4 h-4 flex items-center justify-center text-neutral-400 disabled:opacity-0"
            >
              <SymbolIcon name={isOpen ? "chevron.down" : "chevron.right"} size={9} fallback={isOpen ? "⌄" : "›"} />
            </button>
            <label
              className="flex-1 min-w-0 flex items-center gap-1.5 cursor-default select-none"
              onClick={(e) => {
                // Handled here rather than in onChange, which doesn't carry the shift key
                e.preventDefault();
                handleClick(folder.path, e.shiftKey);
              }}
            >
              <input
                type="checkbox"
                checked={!isExcluded}
                readOnly
                className="accent-blue-500"
              />
              <span className={isExcluded ? "opacity-50" : ""}>
                <FolderIcon size={16} />
              </span>
              <span className={`truncate ${isExcluded ? "text-neutral-500" : "text-neutral-100"}`} title={folder.path}>
                {folder.name}
              </span>
            </label>
          </div>
          {isOpen && renderLevel(folder.path, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div className="max-h-[220px] overflow-y-auto rounded-[6px] border border-neutral-600/70 bg-neutral-900 py-1 text-[13px]">
      {renderLevel(rootPath, 0)}
    </div>
  );
}
