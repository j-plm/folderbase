import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { contentFitWidth, fitColumnWidths, resizeColumn, type ColumnDef } from "../lib/columns";
import { measureText, uiFont } from "../lib/textMeasure";

function loadFixed(storageKey: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(`colw-${storageKey}`) ?? "{}");
  } catch {
    return {};
  }
}

function saveFixed(storageKey: string, fixed: Record<string, number>) {
  localStorage.setItem(`colw-${storageKey}`, JSON.stringify(fixed));
}

/**
 * Fits `columns` to the width of the scroll container and lets the user drag
 * column dividers. Resized widths persist per `storageKey`.
 *
 * `measureCells(columnId)` returns the rendered content width of every cell in
 * that column; double-clicking a divider sizes the column to the widest.
 */
export function useColumnLayout(
  columns: ColumnDef[],
  storageKey: string,
  measureCells: (columnId: string) => number[],
  /** Horizontal padding (each side) between the container edge and the table. */
  inset = 0
) {
  const measureRef = useRef(measureCells);
  measureRef.current = measureCells;
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(0);
  const [fixed, setFixed] = useState<Record<string, number>>(() => loadFixed(storageKey));
  const fixedRef = useRef(fixed);
  fixedRef.current = fixed;

  useEffect(() => {
    setFixed(loadFixed(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (!container) return;
    const measure = () => setAvailable(Math.max(0, container.clientWidth - inset * 2));
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, [container, inset]);

  const widths = useMemo(
    () => fitColumnWidths(columns, available, fixed),
    [columns, available, fixed]
  );
  const totalWidth = columns.reduce((sum, c) => sum + (widths[c.id] ?? 0), 0);

  const startResize = useCallback(
    (columnId: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const column = columns.find((c) => c.id === columnId);
      if (!column) return;
      const startX = e.clientX;
      const startWidths = widths;
      const startWidth = widths[columnId] ?? column.minWidth;

      function onMove(ev: MouseEvent) {
        setFixed(resizeColumn(columns, startWidths, columnId, startWidth + ev.clientX - startX));
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        saveFixed(storageKey, fixedRef.current);
      }
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [columns, widths, storageKey]
  );

  /** Double-clicking a divider sizes that column to its widest content, leaving the others alone. */
  const resetColumn = useCallback(
    (columnId: string) => {
      const column = columns.find((c) => c.id === columnId);
      if (!column) return;
      const headerWidth = measureText(column.label, uiFont(12, 500));
      const width = contentFitWidth(measureRef.current(columnId), headerWidth, column.minWidth);
      const next = resizeColumn(columns, widths, columnId, width);
      setFixed(next);
      saveFixed(storageKey, next);
    },
    [columns, widths, storageKey]
  );

  const fitAll = useCallback(() => {
    setFixed({});
    saveFixed(storageKey, {});
  }, [storageKey]);

  return {
    /** Callback ref for the table's scroll container. */
    setContainer,
    container,
    widths,
    /** Width of the table content: at least the container, wider if columns overflow. */
    contentWidth: Math.max(totalWidth, available),
    startResize,
    resetColumn,
    fitAll,
  };
}
