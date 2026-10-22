import type { Range } from "@tanstack/react-virtual";

type ScrollDirection = "forward" | "backward";

/**
 * Indexes a virtual list renders: the visible ones plus a screen either side,
 * and a second screen ahead in the direction of scrolling, so rows are already
 * laid out (icons and thumbnails loaded) before they come into view. A
 * "screen" is never less than `range.overscan` items.
 */
export function scrollAheadIndexes(range: Range, direction: ScrollDirection | null): number[] {
  const { startIndex, endIndex, overscan, count } = range;
  const screen = Math.max(endIndex - startIndex + 1, overscan);
  const before = screen + (direction === "backward" ? screen : 0);
  const after = screen + (direction === "forward" ? screen : 0);
  const start = Math.max(0, startIndex - before);
  const end = Math.min(count - 1, endIndex + after);
  const indexes: number[] = [];
  for (let i = start; i <= end; i++) indexes.push(i);
  return indexes;
}
