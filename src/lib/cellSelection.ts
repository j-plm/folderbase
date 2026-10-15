// Spreadsheet-style cell selection for the database view's editable columns.
// Cells are addressed by file id and column id, so a selection survives
// re-sorting; `rows` and `cols` give the current display order.

export interface CellRef {
  row: string;
  col: string;
}

export interface CellSelection {
  /** Selected cells, as cellKey strings. */
  cells: Set<string>;
  /** Where Shift-click and Shift-arrow ranges start. */
  anchor: CellRef | null;
  /** The cell the keyboard acts on (edit, move). */
  active: CellRef | null;
}

export interface Grid {
  rows: string[];
  cols: string[];
}

export interface Rect {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export const EMPTY_CELLS: CellSelection = { cells: new Set(), anchor: null, active: null };

export function cellKey(ref: CellRef): string {
  return `${ref.row}\u0000${ref.col}`;
}

export function parseCellKey(key: string): CellRef {
  const [row, col] = key.split("\u0000");
  return { row, col };
}

/** Every cell in the rectangle spanned by `a` and `b`. */
export function rectCells(a: CellRef, b: CellRef, grid: Grid): CellRef[] {
  const ra = grid.rows.indexOf(a.row);
  const rb = grid.rows.indexOf(b.row);
  const ca = grid.cols.indexOf(a.col);
  const cb = grid.cols.indexOf(b.col);
  if (ra < 0 || rb < 0 || ca < 0 || cb < 0) return [b];
  const out: CellRef[] = [];
  for (let r = Math.min(ra, rb); r <= Math.max(ra, rb); r++) {
    for (let c = Math.min(ca, cb); c <= Math.max(ca, cb); c++) {
      out.push({ row: grid.rows[r], col: grid.cols[c] });
    }
  }
  return out;
}

/** Click: selects the cell. Cmd-click toggles it. Shift-click selects the rectangle from the anchor (added to the selection with Cmd too). */
export function clickCell(
  sel: CellSelection,
  ref: CellRef,
  mods: { toggle: boolean; range: boolean },
  grid: Grid
): CellSelection {
  if (mods.range && sel.anchor) {
    const rect = rectCells(sel.anchor, ref, grid).map(cellKey);
    const cells = mods.toggle ? new Set([...sel.cells, ...rect]) : new Set(rect);
    return { cells, anchor: sel.anchor, active: ref };
  }
  if (mods.toggle) {
    const cells = new Set(sel.cells);
    const key = cellKey(ref);
    if (cells.has(key)) cells.delete(key);
    else cells.add(key);
    return { cells, anchor: ref, active: ref };
  }
  return { cells: new Set([cellKey(ref)]), anchor: ref, active: ref };
}

/** Arrow keys: moves the active cell; with Shift, extends the rectangle from the anchor instead. */
export function moveCell(sel: CellSelection, dRow: number, dCol: number, extend: boolean, grid: Grid): CellSelection {
  const from = sel.active;
  if (!from) return sel;
  const r = grid.rows.indexOf(from.row);
  const c = grid.cols.indexOf(from.col);
  if (r < 0 || c < 0) return sel;
  const to: CellRef = {
    row: grid.rows[Math.max(0, Math.min(grid.rows.length - 1, r + dRow))],
    col: grid.cols[Math.max(0, Math.min(grid.cols.length - 1, c + dCol))],
  };
  if (extend && sel.anchor) {
    return { cells: new Set(rectCells(sel.anchor, to, grid).map(cellKey)), anchor: sel.anchor, active: to };
  }
  return { cells: new Set([cellKey(to)]), anchor: to, active: to };
}

/** Drops cells whose row or column is no longer shown. */
export function pruneCells(sel: CellSelection, grid: Grid): CellSelection {
  const rows = new Set(grid.rows);
  const cols = new Set(grid.cols);
  const shown = (ref: CellRef | null) => ref != null && rows.has(ref.row) && cols.has(ref.col);
  const cells = [...sel.cells].filter((k) => shown(parseCellKey(k)));
  if (cells.length === sel.cells.size && (sel.active == null || shown(sel.active))) return sel;
  if (cells.length === 0) return EMPTY_CELLS;
  return {
    cells: new Set(cells),
    anchor: shown(sel.anchor) ? sel.anchor : parseCellKey(cells[0]),
    active: shown(sel.active) ? sel.active : parseCellKey(cells[0]),
  };
}

/** The smallest rectangle (as display indices) containing every selected cell. */
export function boundingRect(sel: CellSelection, grid: Grid): Rect | null {
  let rect: Rect | null = null;
  for (const key of sel.cells) {
    const { row, col } = parseCellKey(key);
    const r = grid.rows.indexOf(row);
    const c = grid.cols.indexOf(col);
    if (r < 0 || c < 0) continue;
    rect = rect
      ? { r0: Math.min(rect.r0, r), r1: Math.max(rect.r1, r), c0: Math.min(rect.c0, c), c1: Math.max(rect.c1, c) }
      : { r0: r, r1: r, c0: c, c1: c };
  }
  return rect;
}

/** Whether the selection is one solid rectangle (the fill handle needs one). */
export function isSolidRect(sel: CellSelection, grid: Grid): Rect | null {
  const rect = boundingRect(sel, grid);
  if (!rect) return null;
  const area = (rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1);
  return area === sel.cells.size ? rect : null;
}

export interface CellWrite {
  row: string;
  col: string;
  value: unknown;
}

/**
 * Dragging the fill handle of `rect` to `targetRow`: the rows between are
 * filled by repeating the selected rows, downward or upward, as Excel does.
 */
export function fillWrites(
  rect: Rect,
  targetRow: number,
  grid: Grid,
  getValue: (row: string, col: string) => unknown
): CellWrite[] {
  const height = rect.r1 - rect.r0 + 1;
  const writes: CellWrite[] = [];
  const add = (r: number, src: number) => {
    for (let c = rect.c0; c <= rect.c1; c++) {
      const col = grid.cols[c];
      writes.push({ row: grid.rows[r], col, value: getValue(grid.rows[src], col) });
    }
  };
  if (targetRow > rect.r1) {
    for (let r = rect.r1 + 1; r <= Math.min(targetRow, grid.rows.length - 1); r++) {
      add(r, rect.r0 + ((r - rect.r0) % height));
    }
  } else if (targetRow < rect.r0) {
    for (let r = rect.r0 - 1; r >= Math.max(targetRow, 0); r--) {
      add(r, rect.r1 - ((rect.r0 - r - 1) % height));
    }
  }
  return writes;
}

/** Copied cells: the selection's bounding rectangle as rows of values (unselected cells inside it are empty). */
export function copyGrid(
  sel: CellSelection,
  grid: Grid,
  getValue: (row: string, col: string) => unknown
): unknown[][] {
  const rect = boundingRect(sel, grid);
  if (!rect) return [];
  const out: unknown[][] = [];
  for (let r = rect.r0; r <= rect.r1; r++) {
    const line: unknown[] = [];
    for (let c = rect.c0; c <= rect.c1; c++) {
      const ref = { row: grid.rows[r], col: grid.cols[c] };
      line.push(sel.cells.has(cellKey(ref)) ? getValue(ref.row, ref.col) : null);
    }
    out.push(line);
  }
  return out;
}

/**
 * Where pasted values land. A single value fills every selected cell; a block
 * is laid out from the selection's top-left cell, clipped to the table.
 */
export function pasteWrites(values: unknown[][], sel: CellSelection, grid: Grid): CellWrite[] {
  if (values.length === 0 || values[0].length === 0) return [];
  if (values.length === 1 && values[0].length === 1) {
    return [...sel.cells].map((k) => ({ ...parseCellKey(k), value: values[0][0] }));
  }
  const rect = boundingRect(sel, grid);
  if (!rect) return [];
  const writes: CellWrite[] = [];
  values.forEach((line, dr) => {
    line.forEach((value, dc) => {
      const r = rect.r0 + dr;
      const c = rect.c0 + dc;
      if (r < grid.rows.length && c < grid.cols.length) {
        writes.push({ row: grid.rows[r], col: grid.cols[c], value });
      }
    });
  });
  return writes;
}

/** Tab-separated text (spreadsheet clipboard format) as rows of cells. */
export function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return lines.map((line) => line.split("\t"));
}

export function toTsv(values: string[][]): string {
  return values.map((line) => line.join("\t")).join("\n");
}
