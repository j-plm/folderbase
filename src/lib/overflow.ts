/**
 * How many leading items fit in `available` px (Finder-style toolbar overflow).
 * If not all fit, room is reserved for the overflow button.
 */
export function visibleItemCount(
  itemWidths: number[],
  gap: number,
  available: number,
  overflowButtonWidth: number
): number {
  const total = itemWidths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0);
  if (total <= available) return itemWidths.length;

  let used = overflowButtonWidth;
  let count = 0;
  for (const w of itemWidths) {
    const next = used + gap + w;
    if (next > available) break;
    used = next;
    count++;
  }
  return count;
}
