// Name patterns for rules: a name with slots where it varies.
//
//   {Code}     captures any text          {Code:4}  exactly 4 characters
//   {*}        any text, not captured     {*:2}     exactly 2 characters
//   {Code:digits}  {Code:4 digits}  {Code:letters}  {Code:upper}  {Code:lower}  {Code:alnum}
//              only that kind of character (any number of them, or exactly 4)
//
// Everything else matches literally, ignoring case. A pattern without a "."
// is matched against the name without its extension (then the whole name). Patterns come from
// route and format-string matching (`/users/{id}`, Python's `parse`).

export interface CompiledPattern {
  regex: RegExp;
  /** Slot names, in order (their capture groups). */
  slots: string[];
  hasDot: boolean;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What a slot may hold: `{Code:digits}`, `{Code:4 letters}`… (case matters only for upper and lower). */
export const SLOT_KINDS: Record<string, { regex: string; label: string }> = {
  digits: { regex: "[0-9]", label: "digits 0–9" },
  letters: { regex: "\\p{L}", label: "letters" },
  upper: { regex: "\\p{Lu}", label: "capital letters" },
  lower: { regex: "\\p{Ll}", label: "small letters" },
  alnum: { regex: "[\\p{L}\\p{N}]", label: "letters and digits" },
  text: { regex: ".", label: "any characters" },
};
const KIND_ALIASES: Record<string, string> = {
  digit: "digits",
  number: "digits",
  numbers: "digits",
  letter: "letters",
  capitals: "upper",
  caps: "upper",
  uppercase: "upper",
  lowercase: "lower",
  alphanumeric: "alnum",
  any: "text",
};

/** A literal character, matched in either case (patterns ignore case outside upper/lower slots). */
function literal(ch: string): string {
  const lo = ch.toLowerCase();
  const up = ch.toUpperCase();
  return lo !== up && lo.length === 1 && up.length === 1 ? `[${escapeRegex(lo)}${escapeRegex(up)}]` : escapeRegex(ch);
}

/** A slot's spec ("4", "digits", "4 digits") as a regex piece, or a message saying what's wrong. */
function slotRegex(spec: string, wildcard: boolean): string | { error: string } {
  if (!spec) return wildcard ? ".*?" : ".+?";
  const m = /^(\d+)?\s*([a-z]+)?$/i.exec(spec);
  if (!m || (!m[1] && !m[2])) return { error: `“${spec}” isn't understood: use a length (4), a kind (digits, letters, upper, lower, alnum) or both (4 digits)` };
  const count = m[1] ? Number(m[1]) : null;
  if (count != null && count <= 0) return { error: "A length must be at least 1" };
  const word = m[2]?.toLowerCase();
  const kind = word ? (SLOT_KINDS[word] ? word : KIND_ALIASES[word]) : "text";
  if (!kind) return { error: `“${word}” isn't a kind: use digits, letters, upper, lower or alnum` };
  const cls = SLOT_KINDS[kind].regex;
  if (count != null) return `${cls}{${count}}`;
  // Any number of a kind takes all of them; plain text takes as little as fits
  return kind === "text" ? (wildcard ? ".*?" : ".+?") : `${cls}+`;
}

/** Compiles a pattern, or explains what's wrong with it. */
export function compilePattern(pattern: string): CompiledPattern | { error: string } {
  let source = "";
  const slots: string[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "}") return { error: "A “}” has no “{” before it" };
    if (ch !== "{") {
      source += literal(ch);
      i++;
      continue;
    }
    const close = pattern.indexOf("}", i);
    if (close === -1) return { error: "A “{” isn't closed" };
    const inner = pattern.slice(i + 1, close).trim();
    const colon = inner.indexOf(":");
    const rawName = (colon === -1 ? inner : inner.slice(0, colon)).trim();
    const spec = colon === -1 ? "" : inner.slice(colon + 1).trim();
    if (!rawName) return { error: "A slot needs a name, like {Code}, or {*} for any text" };
    const any = slotRegex(spec, rawName === "*");
    if (typeof any !== "string") return { error: `{${inner}}: ${any.error}` };
    if (rawName === "*") {
      source += `(?:${any})`;
    } else {
      if (slots.some((s) => s.toLowerCase() === rawName.toLowerCase())) return { error: `“${rawName}” is used twice` };
      slots.push(rawName);
      source += `(${any})`;
    }
    i = close + 1;
  }
  return { regex: new RegExp(`^${source}$`, "u"), slots, hasDot: pattern.includes(".") };
}

export const isPatternError = (p: CompiledPattern | { error: string }): p is { error: string } => "error" in p;

/**
 * The slots a file name fills, or null if it doesn't fit. A pattern without a
 * "." is tried against the name without its extension first, then the whole name.
 */
export function matchPattern(pattern: CompiledPattern, filename: string): Record<string, string> | null {
  const dot = filename.lastIndexOf(".");
  // Without a "." the pattern describes the name itself, so its last slot mustn't swallow the extension
  const candidates = !pattern.hasDot && dot > 0 ? [filename.slice(0, dot), filename] : [filename];
  for (const candidate of candidates) {
    const m = pattern.regex.exec(candidate);
    if (m) return Object.fromEntries(pattern.slots.map((slot, i) => [slot, m[i + 1]]));
  }
  return null;
}

// ── Pick from an example ────────────────────────────────────────────────────

export interface ExampleSlot {
  name: string;
  /** Character range in the example's name (without its extension), end exclusive. */
  start: number;
  end: number;
}

// Folder separators count too, so a path can be picked from like a name
const isSeparator = (ch: string | undefined) => ch == null || /[\s_\-.,()[\]/\\]/.test(ch);

/**
 * A pattern from slots picked in an example name (without its extension):
 * the picked parts become slots and the rest is generalised, separators kept
 * as they are and other runs of text becoming {*}. A slot or run touching
 * other text with no separator between gets a fixed length, so the pattern
 * can tell where it ends.
 *
 *   "Q3_AB12_final", AB12 as Code   →  {*}_{Code}_{*}
 *   "XXAB12rest", AB12 as Code      →  {*:2}{Code:4}{*}
 */
export function examplePattern(name: string, picked: ExampleSlot[]): string {
  const slots = [...picked]
    .filter((s) => s.end > s.start && s.start >= 0 && s.end <= name.length)
    .sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  const gap = (from: number, to: number) => {
    let i = from;
    while (i < to) {
      if (isSeparator(name[i])) {
        out += name[i] === "{" || name[i] === "}" ? "" : name[i];
        i++;
        continue;
      }
      let j = i;
      while (j < to && !isSeparator(name[j])) j++;
      // A run running straight into a slot needs its length, to end where the slot begins
      // (one after a slot needs none: that slot has a fixed length already)
      const touchesSlot = j === to && to < name.length && !isSeparator(name[to]);
      out += touchesSlot ? `{*:${j - i}}` : "{*}";
      i = j;
    }
  };
  for (const slot of slots) {
    if (slot.start < pos) continue; // overlapping picks: the first wins
    gap(pos, slot.start);
    // Running straight into more text, a slot needs its length to know where it ends.
    // A pick that's all digits only takes digits, so it can't run into the text beside it
    const fixed = !isSeparator(name[slot.end]);
    const digits = /^[0-9]+$/.test(name.slice(slot.start, slot.end));
    const length = slot.end - slot.start;
    out += digits
      ? `{${slot.name}:${fixed ? `${length} ` : ""}digits}`
      : fixed
        ? `{${slot.name}:${length}}`
        : `{${slot.name}}`;
    pos = slot.end;
  }
  gap(pos, name.length);
  return out;
}

// ── Reading captured text ───────────────────────────────────────────────────

/**
 * Date formats offered for a captured value (any other made of YYYY, YY, MM, DD,
 * and for a time HH, mm, ss, SSS, with separators, works too). The last few are the
 * names cameras, phones and screenshots give: IMG_20240301_101522, 2024-03-01 10.15.22,
 * and OneDrive's camera uploads, 20250610_094446600_iOS, whose time is UTC.
 */
export const DATE_FORMATS = [
  "YYMMDD",
  "YYYYMMDD",
  "DDMMYY",
  "DDMMYYYY",
  "YYYY-MM-DD",
  "DD-MM-YYYY",
  "DD.MM.YYYY",
  "MMDDYY",
  "YYYYMMDD_HHmmss",
  "YYYYMMDDHHmmss",
  "YYYY-MM-DD HH.mm.ss",
  "YYYYMMDD_HHmmssSSS (UTC)",
];

/** A format's trailing " (UTC)" or " UTC": its time is UTC, not the clock time where it was taken. */
const UTC_SUFFIX = /\s*\(?UTC\)?\s*$/i;

/**
 * Reads `text` as a date in `format` ("YYMMDD", "YYYYMMDD_HHmmss"), as an ISO
 * date, or null if it doesn't fit or isn't a real date. A format with a time
 * gives "YYYY-MM-DDTHH:MM:SS". Letters are read in either case, except that mm
 * after an hour (HH) is the minutes, as in HHmm and HH.mm.ss; elsewhere MM or mm
 * is the month, so "yyyymmdd" still reads as a date. SSS is milliseconds, read
 * past (times are kept to the second). A format ending in "(UTC)" reads its time
 * as UTC and gives the local time of that moment, as Created and Modified show.
 */
export function parseDateAs(text: string, format: string, now: Date = new Date()): string | null {
  const utc = UTC_SUFFIX.test(format);
  if (utc) format = format.replace(UTC_SUFFIX, "");
  const order: ("Y" | "YY" | "M" | "D" | "h" | "m" | "s")[] = [];
  let source = "";
  let i = 0;
  let hour = false;
  while (i < format.length) {
    const rest = format.slice(i).toUpperCase();
    if (rest.startsWith("YYYY")) {
      order.push("Y");
      source += "(\\d{4})";
      i += 4;
    } else if (rest.startsWith("YY")) {
      order.push("YY");
      source += "(\\d{2})";
      i += 2;
    } else if (rest.startsWith("HH")) {
      order.push("h");
      source += "(\\d{2})";
      hour = true;
      i += 2;
    } else if (rest.startsWith("MM")) {
      order.push(hour ? "m" : "M");
      source += "(\\d{2})";
      i += 2;
    } else if (rest.startsWith("DD")) {
      order.push("D");
      source += "(\\d{2})";
      i += 2;
    } else if (rest.startsWith("SSS") && order.includes("s")) {
      // Milliseconds come after the seconds: in HHmmssSSS, "ss" is read first
      source += "\\d{3}";
      i += 3;
    } else if (rest.startsWith("SS")) {
      order.push("s");
      source += "(\\d{2})";
      i += 2;
    } else {
      source += escapeRegex(format[i]);
      i++;
    }
  }
  const m = new RegExp(`^${source}$`).exec(text.trim());
  if (!m) return null;
  let year = 0;
  let month = 0;
  let day = 0;
  const time = [0, 0, 0];
  order.forEach((part, k) => {
    const n = Number(m[k + 1]);
    if (part === "Y") year = n;
    else if (part === "YY") {
      // Two-digit years run up to ten years ahead of now, then back into the 1900s
      const century = Math.floor(now.getFullYear() / 100) * 100;
      year = century + n > now.getFullYear() + 10 ? century - 100 + n : century + n;
    } else if (part === "M") month = n;
    else if (part === "D") day = n;
    else time["hms".indexOf(part)] = n;
  });
  if (!year || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null; // 31 February
  const pad = (n: number) => String(n).padStart(2, "0");
  const key = `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
  if (!hour) return key;
  if (time[0] > 23 || time[1] > 59 || time[2] > 59) return null;
  if (utc) {
    const d = new Date(Date.UTC(year, month - 1, day, time[0], time[1], time[2]));
    return `${String(d.getFullYear()).padStart(4, "0")}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${[d.getHours(), d.getMinutes(), d.getSeconds()].map(pad).join(":")}`;
  }
  return `${key}T${time.map(pad).join(":")}`;
}
