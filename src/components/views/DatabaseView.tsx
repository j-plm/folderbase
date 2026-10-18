import { useCallback, useEffect, useRef } from "react";
import { useNavigation } from "../../contexts/NavigationContext";
import { useDatabaseView } from "../../hooks/useDatabaseView";
import {
  createPropertyValue,
  setFileMetadataArrayAdd,
  setFileMetadataArrayRemove,
  updateFileMetadata,
} from "../../lib/commands";
import type { DbPreset, ViewProps } from "../../types";
import ColumnHeader from "./db/ColumnHeader";
import FilterBar from "./db/FilterBar";
import MetadataCell from "./db/MetadataCell";
import PresetBar from "./db/PresetBar";

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

const COL_NAME = 208;  // w-52
const COL_TYPE = 96;   // w-24
const COL_DATE = 112;  // w-28
const COL_PROP = 160;  // w-40

export default function DatabaseView(_props: ViewProps) {
  const { activeViewId, path, currentLibrary } = useNavigation();

  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const {
    files,
    properties,
    valuesByPropertyId,
    filters,
    sortCol,
    sortDir,
    preset,
    loading,
    error,
    setPreset,
    setSort,
    addFilter,
    removeFilter,
    resetFilters,
    refetchFiles,
    addRegistryValue,
    patchFile,
  } = useDatabaseView(activeViewId, currentLibrary, path);

  // Bi-directional scroll sync via native listeners.
  // Both elements are real scroll containers (overflow-x: scroll) so scrollLeft
  // assignment works in WebKit. Setting scrollLeft to an already-current value
  // does not fire another scroll event, so there is no infinite loop.
  useEffect(() => {
    const header = headerRef.current;
    const body = bodyRef.current;
    if (!header || !body) return;

    function syncBodyFromHeader() {
      body!.scrollLeft = header!.scrollLeft;
    }
    function syncHeaderFromBody() {
      header!.scrollLeft = body!.scrollLeft;
    }

    header.addEventListener("scroll", syncBodyFromHeader);
    body.addEventListener("scroll", syncHeaderFromBody);
    return () => {
      header.removeEventListener("scroll", syncBodyFromHeader);
      body.removeEventListener("scroll", syncHeaderFromBody);
    };
  }, []);

  function handleSort(col: string) {
    if (sortCol === col) {
      setSort(col, sortDir === "asc" ? "desc" : "asc");
    } else {
      setSort(col, "asc");
    }
  }

  const handleScalarSave = useCallback(
    async (fileId: string, key: string, value: string | null) => {
      patchFile(fileId, key, value ?? "");
      await updateFileMetadata(fileId, key, value ?? null);
      refetchFiles();
    },
    [patchFile, refetchFiles]
  );

  const handleArrayAdd = useCallback(
    async (fileId: string, key: string, value: string) => {
      patchFile(fileId, key, [
        ...(Array.isArray(
          (files.find((f) => f.file_id === fileId)?.metadata as Record<string, unknown>)?.[key]
        )
          ? ((files.find((f) => f.file_id === fileId)?.metadata as Record<string, unknown>)[key] as string[])
          : []),
        value,
      ]);
      await setFileMetadataArrayAdd(fileId, key, value);
    },
    [patchFile, files]
  );

  const handleArrayRemove = useCallback(
    async (fileId: string, key: string, value: string) => {
      const current = (files.find((f) => f.file_id === fileId)?.metadata as Record<string, unknown>)?.[key];
      const arr = Array.isArray(current) ? (current as string[]) : [];
      patchFile(fileId, key, arr.filter((v) => v !== value));
      await setFileMetadataArrayRemove(fileId, key, value);
    },
    [patchFile, files]
  );

  const handleNewRegistryValue = useCallback(
    async (propertyId: string, value: string) => {
      const pv = await createPropertyValue(propertyId, value);
      addRegistryValue(pv);
    },
    [addRegistryValue]
  );

  function handlePresetChange(p: DbPreset) {
    setPreset(p);
  }

  const CORE_COLS = [
    { key: "file_name", label: "Name" },
    { key: "file_type", label: "Type" },
    { key: "timestamp", label: "Date" },
  ];

  const minTableWidth = COL_NAME + COL_TYPE + COL_DATE + properties.length * COL_PROP;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <PresetBar active={preset} onChange={handlePresetChange} />

      {preset !== "library" && (
        <FilterBar
          filters={filters}
          properties={properties}
          valuesByPropertyId={valuesByPropertyId}
          onRemove={removeFilter}
          onClear={resetFilters}
          onAdd={addFilter}
        />
      )}

      {error && (
        <div className="px-4 py-2 text-red-400 text-xs border-b border-red-800/40 bg-red-900/20 shrink-0">
          {error}
        </div>
      )}

      {/* Header — overflow-x:scroll so scrollLeft is writable in WebKit;
          scrollbar hidden via .scrollbar-none; driven by body scroll */}
      <div
        ref={headerRef}
        className="scrollbar-none shrink-0 border-b border-neutral-700 bg-neutral-900 group overflow-x-scroll overflow-y-hidden"
      >
        <div className="flex" style={{ minWidth: minTableWidth }}>
          {CORE_COLS.map(({ key, label }, i) => (
            <ColumnHeader
              key={key}
              label={label}
              sortActive={sortCol === key}
              sortDir={sortDir}
              onSort={() => handleSort(key)}
              className={
                i === 0 ? "w-52 shrink-0" :
                i === 1 ? "w-24 shrink-0" :
                           "w-28 shrink-0"
              }
            />
          ))}
          {properties.map((p) => (
            <ColumnHeader
              key={p.property_id}
              label={p.name}
              sortActive={sortCol === p.name}
              sortDir={sortDir}
              onSort={() => handleSort(p.name)}
              className="w-40 shrink-0"
            />
          ))}
        </div>
      </div>

      {/* Body — scrolls both axes; drives header sync via native scroll listener */}
      <div
        ref={bodyRef}
        className="flex-1 overflow-auto isolate"
      >
        {loading && files.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            Loading…
          </div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            {preset === "incomplete"
              ? "No incomplete files — all files are fully classified."
              : "No files match the current filters."}
          </div>
        ) : (
          <div style={{ minWidth: minTableWidth }}>
            {files.map((file) => {
              const meta = (file.metadata ?? {}) as Record<string, unknown>;
              return (
                <div
                  key={file.file_id}
                  className="flex items-center border-b border-neutral-800 hover:bg-neutral-800/40 transition-colors"
                >
                  <div
                    className="w-52 shrink-0 px-2 py-0.5 truncate text-xs text-neutral-200"
                    title={file.file_path}
                  >
                    {basename(file.file_path)}
                  </div>
                  <div className="w-24 shrink-0 px-2 py-0.5 text-xs text-neutral-400 whitespace-nowrap">
                    {file.file_type ?? "—"}
                  </div>
                  <div className="w-28 shrink-0 px-2 py-0.5 text-xs text-neutral-400 whitespace-nowrap">
                    {file.timestamp ? file.timestamp.slice(0, 10) : "—"}
                  </div>
                  {properties.map((p) => (
                    <MetadataCell
                      key={p.property_id}
                      fileId={file.file_id}
                      property={p}
                      currentValue={meta[p.name]}
                      registeredValues={valuesByPropertyId[p.property_id] ?? []}
                      onScalarSave={handleScalarSave}
                      onArrayAdd={handleArrayAdd}
                      onArrayRemove={handleArrayRemove}
                      onNewRegistryValue={handleNewRegistryValue}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="shrink-0 px-3 py-1 border-t border-neutral-700/60 text-xs text-neutral-500 flex items-center justify-between">
        <span>
          {files.length} {files.length === 1 ? "file" : "files"}
          {preset === "path" && filters.length > 0 && " (filtered)"}
        </span>
        {currentLibrary && (
          <span className="text-neutral-500">{currentLibrary}</span>
        )}
      </div>
    </div>
  );
}
