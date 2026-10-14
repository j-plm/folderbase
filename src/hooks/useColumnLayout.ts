import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  COLLAPSE_ANIMATION_MS,
  COLLAPSE_ARM_MS,
  COLLAPSE_DETENT,
  COLLAPSE_HOLD_MS,
  contentFitWidth,
  fitColumnWidths,
  resizeColumn,
  type ColumnDef,
  type ColumnPhase,
} from "../lib/columns";
import { hapticFeedback, poofAt } from "../lib/commands";
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
 *
 * With `onCollapse`, a hideable column can be dragged below its minimum width.
 * It stops at a small detent (with a trackpad haptic) and dims; held there it
 * flashes as a warning, then closes with AppKit's poof (as when a Dock item is
 * removed) and is handed to `onCollapse` to hide. Its saved width is dropped so
 * it comes back at its automatic size. Released before it closes, or dragged
 * back out, it returns to normal resizing.
 */
export function useColumnLayout(
  columns: ColumnDef[],
  storageKey: string,
  measureCells: (columnId: string) => number[],
  /** Horizontal padding (each side) between the container edge and the table. */
  inset = 0,
  onCollapse?: (columnId: string) => void
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

  /** A column being dragged below its minimum width, towards hiding. */
  const [collapsing, setCollapsing] = useState<{ id: string; width: number; phase?: ColumnPhase } | null>(
    null
  );

  const widths = useMemo(() => {
    const fitted = fitColumnWidths(columns, available, fixed);
    return collapsing ? { ...fitted, [collapsing.id]: collapsing.width } : fitted;
  }, [columns, available, fixed, collapsing]);
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
      const canCollapse = !!onCollapse && column.hideable !== false;
      let holdTimer: number | undefined;
      let pointer = { x: e.clientX, y: e.clientY };

      function cancelHold() {
        window.clearTimeout(holdTimer);
        holdTimer = undefined;
      }

      function endDrag() {
        cancelHold();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
      }

      function arm() {
        setCollapsing({ id: columnId, width: COLLAPSE_DETENT, phase: "armed" });
        holdTimer = window.setTimeout(close, COLLAPSE_ARM_MS);
      }

      function close() {
        endDrag();
        hapticFeedback("levelChange");
        poofAt(pointer.x, pointer.y);
        setCollapsing({ id: columnId, width: 0, phase: "closing" });
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.setTimeout(() => {
          const rest = Object.fromEntries(Object.entries(fixedRef.current).filter(([id]) => id !== columnId));
          setFixed(rest);
          saveFixed(storageKey, rest);
          setCollapsing(null);
          onCollapse!(columnId);
        }, reduceMotion ? 0 : COLLAPSE_ANIMATION_MS);
      }

      function onMove(ev: MouseEvent) {
        pointer = { x: ev.clientX, y: ev.clientY };
        const width = startWidth + ev.clientX - startX;
        setFixed(resizeColumn(columns, startWidths, columnId, width));
        if (!canCollapse || width >= column!.minWidth) {
          cancelHold();
          document.body.style.cursor = "col-resize";
          setCollapsing(null);
          return;
        }
        if (width > COLLAPSE_DETENT) {
          cancelHold();
          document.body.style.cursor = "col-resize";
          setCollapsing({ id: columnId, width: Math.round(width) });
          return;
        }
        // At the detent the column stops; holding it there flashes it, then closes it
        if (holdTimer === undefined) {
          hapticFeedback("alignment");
          // The column can't shrink further: show the one-way resize cursor, as AppKit does at a limit
          document.body.style.cursor = "e-resize";
          setCollapsing({ id: columnId, width: COLLAPSE_DETENT, phase: "held" });
          holdTimer = window.setTimeout(arm, COLLAPSE_HOLD_MS);
        }
      }
      function onUp() {
        endDrag();
        // Released before closing: it settles at its minimum width
        setCollapsing(null);
        saveFixed(storageKey, fixedRef.current);
      }
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [columns, widths, storageKey, onCollapse]
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
    /** Hide-by-dragging state of the column being collapsed, for its cells' styling. */
    phaseOf: (columnId: string): ColumnPhase | undefined =>
      collapsing?.id === columnId ? collapsing.phase : undefined,
    /** Width of the table content: at least the container, wider if columns overflow. */
    contentWidth: Math.max(totalWidth, available),
    startResize,
    resetColumn,
    fitAll,
  };
}
