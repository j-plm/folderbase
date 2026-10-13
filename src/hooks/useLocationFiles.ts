import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getFilesForLocation, ingestDirectory } from "../lib/commands";
import type { FileRecord } from "../types";

interface IndexingProgress {
  location_id: string;
  files_scanned: number;
  done: boolean;
}

export function useLocationFiles(locationId: string | null): {
  files: FileRecord[];
  loading: boolean;
  refresh: () => Promise<void>;
  reindex: () => Promise<void>;
} {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFiles = useCallback(async () => {
    if (!locationId) {
      setFiles([]);
      return;
    }
    setLoading(true);
    try {
      const result = await getFilesForLocation(locationId);
      // Tauri serialises Rust `String` fields as JSON strings, so `metadata`
      // and `tags` arrive as raw JSON strings and need to be parsed here.
      const parsed = result.map((f) => {
        const rawMeta = (f as unknown as { metadata: unknown }).metadata;
        const metadata =
          rawMeta == null
            ? null
            : typeof rawMeta === "string"
            ? (() => { try { return JSON.parse(rawMeta); } catch { return null; } })()
            : rawMeta;

        const rawTags = (f as unknown as { tags: unknown }).tags;
        const tags: string[] = Array.isArray(rawTags)
          ? rawTags
          : typeof rawTags === "string"
          ? (() => { try { return JSON.parse(rawTags) as string[]; } catch { return []; } })()
          : [];

        return { ...f, metadata, tags };
      });
      setFiles(parsed);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    setFiles([]);
    fetchFiles();
  }, [locationId, fetchFiles]);

  // Refetch when indexing completes for this location
  useEffect(() => {
    if (!locationId) return;
    let unlisten: (() => void) | null = null;
    listen<IndexingProgress>("indexing_progress", (event) => {
      if (event.payload.location_id !== locationId) return;
      if (event.payload.done) fetchFiles();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [locationId, fetchFiles]);

  const reindex = useCallback(async () => {
    if (!locationId) return;
    try {
      await ingestDirectory(locationId);
    } catch {
      // ignore
    }
  }, [locationId]);

  return { files, loading, refresh: fetchFiles, reindex };
}
