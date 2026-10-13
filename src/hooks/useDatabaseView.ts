import { useState, useEffect, useCallback, useRef } from "react";
import {
  getAllPropertyValues,
  getIncompleteFiles,
  getPathMetadata,
  getProperties,
  queryLibraryFiles,
} from "../lib/commands";
import type {
  DbFilter,
  DbPreset,
  FileRecord,
  Property,
  PropertyValue,
} from "../types";

interface UseDatabaseViewResult {
  files: FileRecord[];
  properties: Property[];
  // Map from property_id to its registered values
  valuesByPropertyId: Record<string, PropertyValue[]>;
  filters: DbFilter[];
  sortCol: string | null;
  sortDir: "asc" | "desc";
  preset: DbPreset;
  loading: boolean;
  error: string | null;
  setPreset: (p: DbPreset) => void;
  setSort: (col: string, dir: "asc" | "desc") => void;
  addFilter: (f: DbFilter) => void;
  removeFilter: (index: number) => void;
  resetFilters: () => void;
  // Call after an inline edit to re-fetch files without changing schema
  refetchFiles: () => void;
  // Add a newly created registry value into local state without a full reload
  addRegistryValue: (pv: PropertyValue) => void;
  // Optimistically update a single file's metadata in local state
  patchFile: (fileId: string, key: string, value: unknown) => void;
}

export function useDatabaseView(
  viewId: string | null,
  library: string | null,
  path: string[]
): UseDatabaseViewResult {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [allValues, setAllValues] = useState<PropertyValue[]>([]);
  const [filters, setFilters] = useState<DbFilter[]>([]);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [preset, setPresetState] = useState<DbPreset>("path");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  // Load schema (properties + values) when library changes
  useEffect(() => {
    if (!library) return;
    Promise.all([getProperties(library), getAllPropertyValues(library)])
      .then(([props, vals]) => {
        setProperties(props);
        setAllValues(vals);
      })
      .catch(() => {});
  }, [library]);

  // Derive initial path filters from the view path
  useEffect(() => {
    if (!viewId || path.length === 0) {
      setFilters([]);
      return;
    }
    getPathMetadata(viewId, path)
      .then((segments) => {
        setFilters(
          segments.map((s) => ({ property: s.property_name, value: s.value }))
        );
      })
      .catch(() => setFilters([]));
  }, [viewId, path.join("\0")]);

  // Fetch files whenever filters / sort / preset / library change
  const fetchFiles = useCallback(() => {
    if (!library) {
      setFiles([]);
      return;
    }
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    const promise =
      preset === "incomplete" && viewId
        ? getIncompleteFiles(viewId)
        : queryLibraryFiles(
            library,
            preset === "library" ? [] : filters,
            sortCol ?? undefined,
            sortDir
          );

    promise
      .then((data) => {
        if (fetchIdRef.current === id) {
          setFiles(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (fetchIdRef.current === id) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
  }, [library, viewId, preset, filters, sortCol, sortDir]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const setPreset = useCallback((p: DbPreset) => {
    setPresetState(p);
  }, []);

  const setSort = useCallback((col: string, dir: "asc" | "desc") => {
    setSortCol(col);
    setSortDir(dir);
  }, []);

  const addFilter = useCallback((f: DbFilter) => {
    setFilters((prev) => [...prev, f]);
  }, []);

  const removeFilter = useCallback((index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters([]);
  }, []);

  const addRegistryValue = useCallback((pv: PropertyValue) => {
    setAllValues((prev) => [...prev, pv]);
  }, []);

  const patchFile = useCallback(
    (fileId: string, key: string, value: unknown) => {
      setFiles((prev) =>
        prev.map((f) => {
          if (f.file_id !== fileId) return f;
          return {
            ...f,
            metadata: { ...(f.metadata as Record<string, unknown>), [key]: value },
          };
        })
      );
    },
    []
  );

  const valuesByPropertyId: Record<string, PropertyValue[]> = {};
  for (const pv of allValues) {
    (valuesByPropertyId[pv.property_id] ??= []).push(pv);
  }

  return {
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
    refetchFiles: fetchFiles,
    addRegistryValue,
    patchFile,
  };
}
