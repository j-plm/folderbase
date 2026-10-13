import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import {
  getLocationProperties,
  getMappingNodes,
  ingestDirectory,
} from "../../lib/commands";
import type { FileRecord } from "../../types";
import PathMappingPanel from "../mapping/PathMappingPanel";

interface Props {
  files: FileRecord[];
  locationId: string;
  onMappingChanged?: () => void;
}

type SortDir = "asc" | "desc" | "default";

interface IndexingProgress {
  location_id: string;
  files_scanned: number;
  done: boolean;
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function fileName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

function fileExtension(filePath: string): string {
  const name = fileName(filePath);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const STANDARD_COLS = ["Name", "Ext", "Path", "Type", "Size", "Created", "Modified"];

const COL_HEAD =
  "px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wide cursor-pointer select-none hover:text-neutral-200 transition-colors whitespace-nowrap";

const COL_HEAD_PASSIVE =
  "px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wide select-none whitespace-nowrap";

export default function LocationDatabaseView({ files, locationId, onMappingChanged }: Props) {
  const [search, setSearch] = useState("");
  // sortKey is a standard field name or "prop:<name>"
  const [sortKey, setSortKey] = useState<string>("relative_path");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [indexing, setIndexing] = useState<{
    scanned: number;
    done: boolean;
  } | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexError, setReindexError] = useState<string | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [hasMappings, setHasMappings] = useState(false);

  // Column visibility
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);
  const [showTags, setShowTags] = useState(false);
  const [visibleProperties, setVisibleProperties] = useState<string[]>([]);
  const [availableProperties, setAvailableProperties] = useState<string[]>([]);

  const parentRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  // Reset view state and load column prefs when switching locations
  useEffect(() => {
    setSearch("");
    setSortKey("relative_path");
    setSortDir("asc");
    setSelectedId(null);
    setIndexing(null);
    setReindexing(false);
    setReindexError(null);
    setMappingOpen(false);
    setColumnsOpen(false);

    const savedTags =
      localStorage.getItem(`col-tags-${locationId}`) === "true";
    let savedProps: string[] = [];
    try {
      savedProps = JSON.parse(
        localStorage.getItem(`col-props-${locationId}`) ?? "[]"
      );
    } catch {}
    setShowTags(savedTags);
    setVisibleProperties(savedProps);
  }, [locationId]);

  useEffect(() => {
    getMappingNodes(locationId)
      .then((nodes) => setHasMappings(nodes.length > 0))
      .catch(() => {});
  }, [locationId]);

  useEffect(() => {
    getLocationProperties(locationId)
      .then((props) => {
        setAvailableProperties(props);
        setVisibleProperties((prev) => prev.filter((p) => props.includes(p)));
      })
      .catch(() => {});
  }, [locationId]);

  // Progress banner + refresh available properties after reindex
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<IndexingProgress>("indexing_progress", (event) => {
      const p = event.payload;
      if (p.location_id !== locationId) return;
      setIndexing({ scanned: p.files_scanned, done: p.done });
      if (p.done) {
        setReindexing(false);
        setTimeout(() => setIndexing(null), 2500);
        getLocationProperties(locationId)
          .then((props) => {
            setAvailableProperties(props);
            setVisibleProperties((prev) => prev.filter((p) => props.includes(p)));
          })
          .catch(() => {});
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [locationId]);

  // Close columns popover on outside click
  useEffect(() => {
    if (!columnsOpen) return;
    function handleOutside(e: MouseEvent) {
      if (
        columnsRef.current &&
        !columnsRef.current.contains(e.target as Node)
      ) {
        setColumnsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [columnsOpen]);

  async function handleReindex() {
    setReindexing(true);
    setReindexError(null);
    setIndexing({ scanned: 0, done: false });
    try {
      await ingestDirectory(locationId);
    } catch (e) {
      setReindexError(String(e));
      setReindexing(false);
      setIndexing(null);
    }
  }

  function toggleShowTags() {
    const next = !showTags;
    setShowTags(next);
    localStorage.setItem(`col-tags-${locationId}`, String(next));
  }

  function toggleProperty(name: string) {
    const next = visibleProperties.includes(name)
      ? visibleProperties.filter((p) => p !== name)
      : [...visibleProperties, name];
    setVisibleProperties(next);
    localStorage.setItem(`col-props-${locationId}`, JSON.stringify(next));
  }

  // Bi-directional scroll sync: header and body are both real scroll containers
  // so scrollLeft assignment works in WebKit. Setting scrollLeft to an already-
  // current value never fires another scroll event, so there is no loop.
  useEffect(() => {
    const header = headerScrollRef.current;
    const body = parentRef.current;
    if (!header || !body) return;
    function syncBodyFromHeader() { body!.scrollLeft = header!.scrollLeft; }
    function syncHeaderFromBody() { header!.scrollLeft = body!.scrollLeft; }
    header.addEventListener("scroll", syncBodyFromHeader);
    body.addEventListener("scroll", syncHeaderFromBody);
    return () => {
      header.removeEventListener("scroll", syncBodyFromHeader);
      body.removeEventListener("scroll", syncHeaderFromBody);
    };
  }, []);

  const filtered = files.filter((f) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = fileName(f.file_path).toLowerCase();
    const rel = (f.relative_path ?? "").toLowerCase();
    return name.includes(q) || rel.includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortDir === "default") return 0;

    let av: string | number | null = null;
    let bv: string | number | null = null;

    if (sortKey.startsWith("prop:")) {
      const propName = sortKey.slice(5);
      const am = a.metadata as Record<string, unknown> | null;
      const bm = b.metadata as Record<string, unknown> | null;
      av = (am?.[propName] as string) ?? null;
      bv = (bm?.[propName] as string) ?? null;
      // Nulls last for asc, nulls first for desc
      if (av == null && bv == null) return 0;
      if (av == null) return sortDir === "asc" ? 1 : -1;
      if (bv == null) return sortDir === "asc" ? -1 : 1;
    } else {
      switch (sortKey) {
        case "file_name":
          av = fileName(a.file_path);
          bv = fileName(b.file_path);
          break;
        case "relative_path":
          av = a.relative_path ?? a.file_path;
          bv = b.relative_path ?? b.file_path;
          break;
        case "file_type":
          av = a.file_type ?? "";
          bv = b.file_type ?? "";
          break;
        case "file_size":
          av = a.file_size ?? -1;
          bv = b.file_size ?? -1;
          break;
        case "timestamp":
          av = a.timestamp ?? "";
          bv = b.timestamp ?? "";
          break;
        case "modified_at":
          av = a.modified_at ?? "";
          bv = b.modified_at ?? "";
          break;
      }
    }

    if (av == null) av = "";
    if (bv == null) bv = "";
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  function handleSortClick(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((prev) =>
        prev === "asc" ? "desc" : prev === "desc" ? "default" : "asc"
      );
    }
  }

  function sortIndicator(key: string) {
    if (sortKey !== key) return null;
    if (sortDir === "asc") return " ↑";
    if (sortDir === "desc") return " ↓";
    return null;
  }

  const extraColCount = (showTags ? 1 : 0) + visibleProperties.length;

  // Minimum table width so header and body share the same horizontal scroll extent.
  // Name=208 Ext=80 Path=240 Type=112 Size=96 Created=112 Modified=112 + optionals
  const minTableWidth =
    208 + 80 + 240 + 112 + 96 + 112 + 112 +
    (showTags ? 160 : 0) +
    visibleProperties.length * 128;

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-neutral-700/60 shrink-0">
        <div className="flex-1 min-w-0">
          <span className="text-neutral-500 text-xs">
            {sorted.length.toLocaleString()} files
          </span>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files…"
          className="w-52 px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-blue-500 transition-colors"
        />
        <button
          onClick={() => setMappingOpen(true)}
          className={`px-2.5 py-1.5 text-xs rounded border transition-colors shrink-0 ${
            hasMappings
              ? "border-blue-500/60 text-blue-400 hover:text-blue-300 hover:border-blue-400"
              : "border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600"
          }`}
        >
          {hasMappings ? "● Map Structure" : "Map Structure"}
        </button>
        <button
          onClick={handleReindex}
          disabled={reindexing}
          className="px-2.5 py-1.5 text-xs rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 disabled:opacity-50 transition-colors shrink-0"
        >
          {reindexing ? "Indexing…" : "Re-index"}
        </button>

        {/* Columns button + popover */}
        <div ref={columnsRef} className="relative shrink-0">
          <button
            onClick={() => setColumnsOpen((v) => !v)}
            className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
              extraColCount > 0 || columnsOpen
                ? "border-blue-500/60 text-blue-400 hover:text-blue-300 hover:border-blue-400"
                : "border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600"
            }`}
          >
            {extraColCount > 0 ? `Columns (${extraColCount})` : "Columns"}
          </button>

          {columnsOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 w-56 bg-neutral-900 border border-neutral-700/60 rounded-lg shadow-xl py-2">
              {/* Standard section */}
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
                Standard
              </div>
              {STANDARD_COLS.map((label) => (
                <div
                  key={label}
                  className="flex items-center gap-2 px-3 py-1.5 opacity-40"
                >
                  <span className="w-3.5 h-3.5 rounded border border-neutral-500 flex items-center justify-center text-[9px] text-neutral-300 shrink-0">
                    ✓
                  </span>
                  <span className="text-xs text-neutral-400">{label}</span>
                </div>
              ))}

              <div className="my-1.5 border-t border-neutral-800" />

              {/* Metadata section */}
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
                Metadata
              </div>
              <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800/60 cursor-pointer">
                <span
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] shrink-0 transition-colors ${
                    showTags
                      ? "bg-blue-500 border-blue-500 text-white"
                      : "border-neutral-600 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="text-xs text-neutral-300">Tags</span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={showTags}
                  onChange={toggleShowTags}
                />
              </label>
              {availableProperties.length === 0 ? (
                <p className="px-3 pt-1 pb-2 text-[11px] text-neutral-600 leading-snug">
                  No properties mapped yet — use Map Structure to assign folder
                  levels
                </p>
              ) : (
                availableProperties.map((name) => (
                  <label
                    key={name}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800/60 cursor-pointer"
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] shrink-0 transition-colors ${
                        visibleProperties.includes(name)
                          ? "bg-blue-500 border-blue-500 text-white"
                          : "border-neutral-600 text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    <span className="text-xs text-neutral-300">{name}</span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={visibleProperties.includes(name)}
                      onChange={() => toggleProperty(name)}
                    />
                  </label>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {reindexError && (
        <div className="px-4 py-2 bg-red-950/40 text-red-400 text-xs border-b border-red-900/40 shrink-0">
          {reindexError}
        </div>
      )}
      {indexing && !indexing.done && (
        <div className="px-4 py-2 bg-blue-950/40 text-blue-300 text-xs border-b border-blue-900/40 shrink-0">
          Indexing… {indexing.scanned.toLocaleString()} files scanned
        </div>
      )}
      {indexing && indexing.done && (
        <div className="px-4 py-2 bg-green-950/40 text-green-300 text-xs border-b border-green-900/40 shrink-0">
          {indexing.scanned.toLocaleString()} files indexed
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Table header — real scroll container so scrollLeft is writable in WebKit;
          scrollbar hidden via .scrollbar-none; position driven by body scroll */}
      <div
        ref={headerScrollRef}
        className="scrollbar-none shrink-0 border-b border-neutral-700/60 bg-neutral-800/30 overflow-x-scroll overflow-y-hidden"
      >
        <div className="flex" style={{ minWidth: minTableWidth }}>
          <button
            className={`${COL_HEAD} w-52 shrink-0`}
            onClick={() => handleSortClick("file_name")}
          >
            Name{sortIndicator("file_name")}
          </button>
          <div className={`${COL_HEAD_PASSIVE} w-20 shrink-0`}>Ext</div>
          <button
            className={`${COL_HEAD} flex-1 min-w-0`}
            onClick={() => handleSortClick("relative_path")}
          >
            Path{sortIndicator("relative_path")}
          </button>
          <button
            className={`${COL_HEAD} w-28 shrink-0`}
            onClick={() => handleSortClick("file_type")}
          >
            Type{sortIndicator("file_type")}
          </button>
          <button
            className={`${COL_HEAD} w-24 shrink-0 text-right`}
            onClick={() => handleSortClick("file_size")}
          >
            Size{sortIndicator("file_size")}
          </button>
          <button
            className={`${COL_HEAD} w-28 shrink-0`}
            onClick={() => handleSortClick("timestamp")}
          >
            Created{sortIndicator("timestamp")}
          </button>
          <button
            className={`${COL_HEAD} w-28 shrink-0`}
            onClick={() => handleSortClick("modified_at")}
          >
            Modified{sortIndicator("modified_at")}
          </button>
          {showTags && (
            <div className={`${COL_HEAD_PASSIVE} w-40 shrink-0`}>Tags</div>
          )}
          {visibleProperties.map((name) => (
            <button
              key={name}
              className={`${COL_HEAD} w-32 shrink-0`}
              onClick={() => handleSortClick(`prop:${name}`)}
            >
              {name}
              {sortIndicator(`prop:${name}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {sorted.length === 0 && (
        <div className="flex items-center justify-center flex-1 text-neutral-600 text-sm">
          {files.length === 0
            ? indexing && !indexing.done
              ? "Indexing…"
              : "No files indexed. Try Re-index."
            : "No files match your search"}
        </div>
      )}
      {sorted.length > 0 && (
        <div ref={parentRef} className="flex-1 overflow-auto">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
              minWidth: minTableWidth,
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const file = sorted[virtualRow.index];
              const isSelected = file.file_id === selectedId;
              const name = fileName(file.file_path);
              const tags = Array.isArray(file.tags) ? file.tags : [];
              const metadata = file.metadata as Record<
                string,
                unknown
              > | null;
              return (
                <div
                  key={file.file_id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() =>
                    setSelectedId(isSelected ? null : file.file_id)
                  }
                  className={`flex items-center border-b border-neutral-800/60 cursor-default transition-colors ${
                    isSelected ? "bg-blue-900/30" : "hover:bg-neutral-800/40"
                  }`}
                >
                  <div className="w-52 px-3 text-xs text-neutral-200 truncate shrink-0">
                    {name}
                  </div>
                  <div className="w-20 px-3 shrink-0">
                    {fileExtension(file.file_path) && (
                      <span className="font-mono text-[10px] text-neutral-500 bg-neutral-800 px-1.5 py-0.5 rounded">
                        {fileExtension(file.file_path)}
                      </span>
                    )}
                  </div>
                  <div
                    className="flex-1 min-w-0 px-3 text-xs text-neutral-500 truncate"
                    title={file.relative_path ?? file.file_path}
                  >
                    {file.relative_path ?? file.file_path}
                  </div>
                  <div className="w-28 px-3 shrink-0">
                    {file.file_type && (
                      <span className="font-mono text-[10px] text-neutral-500 bg-neutral-800 px-1.5 py-0.5 rounded truncate block max-w-full">
                        {file.file_type}
                      </span>
                    )}
                  </div>
                  <div className="w-24 px-3 text-xs text-neutral-500 text-right shrink-0">
                    {formatSize(file.file_size)}
                  </div>
                  <div className="w-28 px-3 text-xs text-neutral-500 shrink-0">
                    {formatDate(file.timestamp)}
                  </div>
                  <div className="w-28 px-3 text-xs text-neutral-500 shrink-0">
                    {formatDate(file.modified_at)}
                  </div>
                  {showTags && (
                    <div className="w-40 px-3 shrink-0">
                      <TagPills tags={tags} />
                    </div>
                  )}
                  {visibleProperties.map((propName) => (
                    <div
                      key={propName}
                      className="w-32 px-3 shrink-0 text-xs truncate"
                    >
                      {metadata?.[propName] != null ? (
                        <span className="text-neutral-300">
                          {String(metadata[propName])}
                        </span>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>

      {mappingOpen && (
        <PathMappingPanel
          locationId={locationId}
          onClose={() => {
            setMappingOpen(false);
            getMappingNodes(locationId)
              .then((nodes) => setHasMappings(nodes.length > 0))
              .catch(() => {});
            getLocationProperties(locationId)
              .then((props) => {
                setAvailableProperties(props);
                setVisibleProperties((prev) => prev.filter((p) => props.includes(p)));
              })
              .catch(() => {});
            onMappingChanged?.();
          }}
        />
      )}
    </div>
  );
}

const MAX_TAGS_SHOWN = 4;

function TagPills({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, MAX_TAGS_SHOWN);
  const overflow = tags.length - MAX_TAGS_SHOWN;
  return (
    <div className="flex flex-wrap gap-1 overflow-hidden">
      {shown.map((tag) => (
        <span
          key={tag}
          className="font-mono text-[10px] text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0"
        >
          {tag}
        </span>
      ))}
      {overflow > 0 && (
        <span className="font-mono text-[10px] text-neutral-600 bg-neutral-800/60 px-1.5 py-0.5 rounded shrink-0">
          +{overflow}
        </span>
      )}
    </div>
  );
}
