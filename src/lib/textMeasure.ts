// Measures rendered text width without touching the DOM, so columns can be
// sized to content even when rows are virtualised and not rendered.

let context: CanvasRenderingContext2D | null | undefined;
let bodyFamily: string | undefined;
/** Widths already measured, per font. Labels are re-measured on every render. */
const widths = new Map<string, Map<string, number>>();
/** Bound on cached widths per font, so long sessions don't grow without limit. */
const MAX_CACHED = 5000;

/** CSS font shorthand in the app's UI font family. */
export function uiFont(sizePx: number, weight = 400, family?: string): string {
  // Reading computed style forces a style recalculation; the family never changes
  const fam = family ?? (bodyFamily ??= getComputedStyle(document.body).fontFamily);
  return `${weight} ${sizePx}px ${fam}`;
}

export function measureText(text: string, font: string): number {
  let cache = widths.get(font);
  const cached = cache?.get(text);
  if (cached !== undefined) return cached;

  if (context === undefined) context = document.createElement("canvas").getContext("2d");
  if (!context) return text.length * 7; // no canvas (tests): rough estimate
  if (context.font !== font) context.font = font;
  const width = context.measureText(text).width;

  if (!cache) widths.set(font, (cache = new Map()));
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(text, width);
  return width;
}
