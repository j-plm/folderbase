// Measures rendered text width without touching the DOM, so columns can be
// sized to content even when rows are virtualised and not rendered.

let context: CanvasRenderingContext2D | null | undefined;
let bodyFamily: string | undefined;
/** Widths already measured, per font. Labels are re-measured on every render. */
const widths = new Map<string, Map<string, number>>();
/** Bound on cached widths per font, so long sessions don't grow without limit. */
const MAX_CACHED = 50000;

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

/** Widths of elements already measured, per class list. */
const elementWidths = new Map<string, Map<string, number>>();

/**
 * Widths of `texts` each laid out as a `<span class={className}>`, as the page
 * renders them: canvas text widths can come out a fraction wider than the
 * DOM's, which is enough to mispredict where a row of pills wraps. Unmeasured
 * texts are measured together in one layout pass; results are cached per class.
 */
export function measureElements(texts: Iterable<string>, className: string): Map<string, number> {
  let cache = elementWidths.get(className);
  if (!cache) elementWidths.set(className, (cache = new Map()));
  const unique = [...new Set(texts)];
  let missing = unique.filter((t) => !cache!.has(t));
  if (missing.length === 0) return cache;
  if (cache.size + missing.length > MAX_CACHED) {
    cache.clear();
    missing = unique;
  }
  if (typeof document === "undefined" || !document.body) {
    for (const t of missing) cache.set(t, t.length * 7); // no DOM (tests): rough estimate
    return cache;
  }
  const box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;display:flex;flex-direction:column;align-items:flex-start";
  const spans = missing.map((t) => {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = t;
    box.appendChild(span);
    return span;
  });
  document.body.appendChild(box);
  spans.forEach((span, i) => cache!.set(missing[i], span.getBoundingClientRect().width));
  box.remove();
  return cache;
}
