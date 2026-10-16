/** Characters kept after the ellipsis so the extension stays visible ("…lmer.pdf"). */
const TAIL_LENGTH = 8;

/**
 * Finder icon-view label: at most two lines. The first line breaks at the last
 * space that fits (or mid-word if there is none); if the rest still doesn't
 * fit, the second line is truncated in the middle, keeping the end of the name.
 */
export function twoLineLabel(
  name: string,
  maxWidth: number,
  measure: (text: string) => number
): string[] {
  if (measure(name) <= maxWidth) return [name];

  const cut = Math.max(longestFit(name.length, (n) => measure(name.slice(0, n)) <= maxWidth), 1);
  const space = name.lastIndexOf(" ", cut);
  const lineEnd = space > 0 ? space : cut;
  const first = name.slice(0, lineEnd);
  const rest = name.slice(space > 0 ? space + 1 : cut);

  if (measure(rest) <= maxWidth) return [first, rest];

  const tail = rest.slice(-TAIL_LENGTH);
  const head = rest.slice(0, rest.length - TAIL_LENGTH);
  const keep = longestFit(head.length, (n) => measure(`${head.slice(0, n)}…${tail}`) <= maxWidth);
  return [first, `${head.slice(0, keep)}…${tail}`];
}

/**
 * The largest n in 0..max for which `fits(n)` holds, given that it holds for
 * every smaller n too (text only gets wider as characters are added). A binary
 * search: a handful of measurements instead of one per character.
 */
function longestFit(max: number, fits: (n: number) => boolean): number {
  let lo = 0;
  let hi = max;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Single-line Finder truncation: keeps the start and the end of the name with
 * an ellipsis in the middle ("NewMotionLa…rack-Chairing").
 */
export function middleTruncate(
  name: string,
  maxWidth: number,
  measure: (text: string) => number
): string {
  if (measure(name) <= maxWidth) return name;
  let head = Math.ceil(name.length / 2);
  let tail = Math.floor(name.length / 2);
  while (head + tail > 0) {
    const candidate = `${name.slice(0, head)}…${name.slice(name.length - tail)}`;
    if (measure(candidate) <= maxWidth) return candidate;
    if (head >= tail) head--;
    else tail--;
  }
  return "…";
}
