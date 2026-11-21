import type { PreviewRect } from "./commands";

// The live preview is a native view laid over the page, so it draws above
// everything in it. Where something else (a sheet, a popover, the drag image)
// is over its placeholder, it has to go, and the still preview beneath shows.

/** How far in from the edges the placeholder is sampled, so a neighbour's border doesn't count. */
const INSET = 3;

/** The points sampled to see whether anything covers `rect`: its centre and near each corner. */
export function samplePoints(rect: PreviewRect): [number, number][] {
  const { x, y, width, height } = rect;
  const left = x + Math.min(INSET, width / 2);
  const right = x + width - Math.min(INSET, width / 2);
  const top = y + Math.min(INSET, height / 2);
  const bottom = y + height - Math.min(INSET, height / 2);
  return [
    [x + width / 2, y + height / 2],
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ];
}

/**
 * Whether anything is over the placeholder: true when the topmost element at
 * any sampled point (`hit`) isn't the placeholder or inside it (`isOwn`).
 */
export function isCovered<T>(
  rect: PreviewRect,
  hit: (x: number, y: number) => T | null,
  isOwn: (element: T) => boolean
): boolean {
  return samplePoints(rect).some(([x, y]) => {
    const element = hit(x, y);
    return !element || !isOwn(element);
  });
}

/** The place to send, rounded to whole pixels, or null when there's nothing to show. */
export function previewPlace(rect: PreviewRect): PreviewRect | null {
  const place = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
  return place.width > 0 && place.height > 0 ? place : null;
}
