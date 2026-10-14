// Measures rendered text width without touching the DOM, so columns can be
// sized to content even when rows are virtualised and not rendered.

let context: CanvasRenderingContext2D | null | undefined;

/** CSS font shorthand in the app's UI font family. */
export function uiFont(sizePx: number, weight = 400, family?: string): string {
  const fam = family ?? getComputedStyle(document.body).fontFamily;
  return `${weight} ${sizePx}px ${fam}`;
}

export function measureText(text: string, font: string): number {
  if (context === undefined) context = document.createElement("canvas").getContext("2d");
  if (!context) return text.length * 7; // no canvas (tests): rough estimate
  context.font = font;
  return context.measureText(text).width;
}
