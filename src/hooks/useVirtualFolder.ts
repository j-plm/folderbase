import { useState, useEffect, useCallback, useRef } from "react";
import { queryVirtualFolder } from "../lib/commands";
import type { QueryResult } from "../types";

interface UseVirtualFolderResult {
  result: QueryResult | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useVirtualFolder(
  viewId: string | null,
  path: string[]
): UseVirtualFolderResult {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the latest fetch so stale responses don't overwrite newer ones
  const fetchIdRef = useRef(0);

  const fetch = useCallback(() => {
    if (!viewId) {
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    queryVirtualFolder(viewId, path)
      .then((data) => {
        if (fetchIdRef.current === id) {
          setResult(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (fetchIdRef.current === id) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    // Keyed on path contents so a new array with the same segments doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, path.join("\0")]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { result, loading, error, refetch: fetch };
}
