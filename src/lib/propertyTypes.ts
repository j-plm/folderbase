import type { NumberFormat, Property, PropertyConfig, ValueType } from "../types";

// Custom property types: how values display, how typed or pasted text becomes a
// stored value, and how values move between types. Mirrors convert_value and
// parse_number in src-tauri/src/commands/metadata.rs.

export const TYPE_OPTIONS: { type: ValueType; label: string }[] = [
  { type: "free_text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "enum", label: "Select" },
  { type: "array", label: "Multi-select" },
];

export const NUMBER_FORMATS: { format: NumberFormat; label: string }[] = [
  { format: "generic", label: "Number" },
  { format: "currency", label: "Currency" },
  { format: "percent", label: "Percentage" },
];

export const CURRENCIES = ["GBP", "USD", "EUR", "JPY", "CHF", "CAD", "AUD", "CNY", "INR", "SEK"];

export function typeLabel(type: ValueType): string {
  return TYPE_OPTIONS.find((o) => o.type === type)?.label ?? type;
}

/**
 * Values extracted from the file at indexing (EXIF), shown read-only like Size
 * and Created. Keep in step with extract_exif in src-tauri/src/commands/ingest.rs.
 */
export const EXTRACTED_LABELS: Record<string, string> = {
  camera_make: "Camera Make",
  camera_model: "Camera Model",
  date_taken: "Date Taken",
  focal_length: "Focal Length",
  iso: "ISO",
  width: "Width",
  height: "Height",
  latitude: "Latitude",
  longitude: "Longitude",
};
export const EXTRACTED_KEYS = new Set(Object.keys(EXTRACTED_LABELS));

/** What a property is called on screen: extracted values get readable names, others their own. */
export function propertyLabel(name: string): string {
  return EXTRACTED_LABELS[name] ?? name;
}

export function parseConfig(property: Pick<Property, "config"> | null | undefined): PropertyConfig {
  if (!property?.config) return {};
  try {
    return JSON.parse(property.config) as PropertyConfig;
  } catch {
    return {};
  }
}

const REGION_CURRENCY: Record<string, string> = {
  GB: "GBP", US: "USD", JP: "JPY", CH: "CHF", CA: "CAD", AU: "AUD", CN: "CNY", IN: "INR", SE: "SEK",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", BE: "EUR", AT: "EUR", PT: "EUR", FI: "EUR",
};

/** The currency for the user's region, for new currency columns. */
export function defaultCurrency(locale: string = navigator.language): string {
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  return (region && REGION_CURRENCY[region]) || "USD";
}

/** Reads "1,200", "£12.50" or "25%" (as 0.25). Words containing digits aren't numbers. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  const percent = trimmed.endsWith("%");
  const body = percent ? trimmed.slice(0, -1) : trimmed;
  if (!/\d/.test(body) || /[^\d\s.,+\-eE£$€¥₹]/.test(body)) return null;
  const n = Number(body.replace(/[^\d.+\-eE]/g, ""));
  if (!Number.isFinite(n)) return null;
  return percent ? n / 100 : n;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A Date in local time as "YYYY-MM-DDTHH:MM:SS". */
function localKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * A date as "YYYY-MM-DD", or with its time as "YYYY-MM-DDTHH:MM:SS", from ISO
 * text and EXIF ("2024:03:01 10:00:00"); else null. A time with a zone (Created,
 * Modified: "…Z", "…+00:00") is a moment, given in local time; one without is
 * kept as written, the clock time the camera or file name gave. These keys sort
 * as text, a date alone before the same day with a time.
 */
export function dateTimeKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})[-:](\d{2})[-:](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?/i.exec(value.trim());
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] == null) return day;
  if (m[7]) {
    const d = new Date(`${day}T${m[4]}:${m[5]}:${m[6] ?? "00"}${m[7].length === 5 ? `${m[7].slice(0, 3)}:${m[7].slice(3)}` : m[7]}`);
    return Number.isNaN(d.getTime()) ? day : localKey(d);
  }
  return `${day}T${m[4]}:${m[5]}:${m[6] ?? "00"}`;
}

/** "YYYY-MM-DD" for a date, with or without a time (see dateTimeKey), else null. */
export function dateKey(value: unknown): string | null {
  return dateTimeKey(value)?.slice(0, 10) ?? null;
}

/** "HH:MM:SS" when a date has a time, else null. */
export function timeOfKey(key: string): string | null {
  return key.length > 10 ? key.slice(11, 19) : null;
}

/** A date key (see dateTimeKey) as a local Date. */
export function keyToDate(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  const [h, min, s] = (timeOfKey(key) ?? "00:00:00").split(":").map(Number);
  return new Date(y, m - 1, d, h, min, s);
}

function parseDate(text: string): string | null {
  const key = dateTimeKey(text.trim());
  if (key) return key;
  const t = Date.parse(text);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  // "1 March 2024 10:15" keeps its time; "1 March 2024" is a date alone
  return /\d:\d{2}/.test(text) ? localKey(d) : localKey(d).slice(0, 10);
}

/** Plain text for a stored value: what copy puts on the clipboard. */
export function valueToText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join(", ");
  return String(value);
}

/**
 * The value to store when `text` is typed or pasted into a cell of this type;
 * null clears the cell. Text that doesn't fit the type is kept as typed, as
 * the backend does when converting, so nothing the user enters is lost.
 */
export function parseInput(text: string, type: ValueType, config: PropertyConfig = {}): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  switch (type) {
    case "number": {
      const n = parseNumber(trimmed);
      if (n == null) return trimmed;
      // In a percentage column "25" means 25%, as in Numbers and Excel
      return config.format === "percent" && !trimmed.endsWith("%") ? n / 100 : n;
    }
    case "date":
      return parseDate(trimmed) ?? trimmed;
    case "array": {
      const items = [...new Set(trimmed.split(",").map((s) => s.trim()).filter(Boolean))];
      return items.length ? items : null;
    }
    default:
      return trimmed;
  }
}

/** A value copied from one cell, made fit for a cell of this type. */
export function coerceValue(value: unknown, type: ValueType, config: PropertyConfig = {}): unknown {
  if (value == null || value === "") return null;
  if (type === "array" && Array.isArray(value)) return value.length ? value : null;
  if (type === "number" && typeof value === "number") return value;
  if (Array.isArray(value)) return parseInput(valueToText(value), type, config);
  if (type === "array") return [valueToText(value)];
  return parseInput(valueToText(value), type, config);
}

/** Display text for a stored value. */
export function formatValue(value: unknown, type: ValueType | undefined, config: PropertyConfig = {}): string {
  if (value == null || value === "") return "";
  if (type === "number" && typeof value === "number") {
    try {
      if (config.format === "currency") {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: config.currency || "USD" }).format(value);
      }
      if (config.format === "percent") {
        return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 }).format(value);
      }
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 }).format(value);
    } catch {
      return String(value);
    }
  }
  if (type === "date") {
    const key = dateTimeKey(value);
    if (key) return formatDate(config.hideTime ? key.slice(0, 10) : key, config.dateFormat);
  }
  return valueToText(value);
}

/** Text to start an inline editor with: plain, unformatted, and percentages as typed. */
export function editText(value: unknown, type: ValueType, config: PropertyConfig = {}): string {
  if (type === "number" && typeof value === "number" && config.format === "percent") {
    return String(Math.round(value * 100 * 1e6) / 1e6);
  }
  return valueToText(value);
}

/** List values in a cell (Select and Multi-select), as an array. */
export function listValues(value: unknown): string[] {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value.map(valueToText).filter(Boolean) : [valueToText(value)];
}

/** The choices in the header's "+" menu: a type, and the default name of a new column of it. */
export function newPropertyKinds(
  currency: string = defaultCurrency()
): { label: string; type: ValueType; config: PropertyConfig | null }[] {
  // Multi-select first: the default kind of property, as a file can belong to several things
  return [
    { label: "Multi-select", type: "array", config: null },
    { label: "Select", type: "enum", config: null },
    { label: "Text", type: "free_text", config: null },
    { label: "Number", type: "number", config: { format: "generic" } },
    { label: "Currency", type: "number", config: { format: "currency", currency } },
    { label: "Percentage", type: "number", config: { format: "percent" } },
    { label: "Date", type: "date", config: null },
  ];
}

/** `base`, or "base 2", "base 3"… whichever is first not in `taken` (ignoring case). */
export function uniqueName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!lower.has(name.toLowerCase())) return name;
  }
}

// ── Date formats ────────────────────────────────────────────────────────────

/** The date formats offered for a Date property, with an example of each. */
export const DATE_DISPLAY_FORMATS: { id: string; label: string }[] = [
  { id: "short", label: "Short" },
  { id: "medium", label: "Medium" },
  { id: "long", label: "Long" },
  { id: "full", label: "Full" },
  { id: "iso", label: "ISO 8601" },
  { id: "relative", label: "Relative" },
];

const DAY_MS = 86_400_000;

/** A Date property's settings as stored: defaults (Medium, times shown) left out, null when nothing's left. */
export function dateConfig(config: PropertyConfig): PropertyConfig | null {
  const out: PropertyConfig = {};
  if (config.dateFormat && config.dateFormat !== "medium") out.dateFormat = config.dateFormat;
  if (config.hideTime) out.hideTime = true;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * A stored date (YYYY-MM-DD, or with a time: YYYY-MM-DDTHH:MM:SS) as a Date
 * property shows it. The named formats follow the system's own date styles,
 * a time following as Finder shows one ("1 Mar 2024 at 10:15"); "custom:<pattern>"
 * uses tokens: YYYY YY (year) · MMMM MMM MM M (month) · DD D (day) · dddd ddd
 * (weekday) · HH H (hour) · mm (minute) · ss (second); text in [brackets] is
 * shown as it is. A custom pattern shows a time only through its own tokens.
 */
export function formatDate(key: string, format: string | undefined, now: Date = new Date()): string {
  const date = keyToDate(key);
  const time = timeOfKey(key);
  const at = (day: string) =>
    time ? `${day} at ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : day;
  try {
    switch (format ?? "medium") {
      case "short":
        return time
          ? date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
          : date.toLocaleDateString(undefined, { dateStyle: "short" });
      case "long":
        return at(date.toLocaleDateString(undefined, { dateStyle: "long" }));
      case "full":
        return at(date.toLocaleDateString(undefined, { dateStyle: "full" }));
      case "iso":
        return time ? `${key.slice(0, 10)} ${time}` : key;
      case "relative": {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        const days = Math.round((day - today) / DAY_MS);
        // A week either way reads as days ("yesterday", "in 3 days"); further off, as a date
        if (Math.abs(days) <= 7) return at(new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(days, "day"));
        return at(date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
      }
      case "medium":
        return at(date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
      default:
        if (format?.startsWith("custom:")) return formatDatePattern(date, format.slice("custom:".length));
        return at(date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
    }
  } catch {
    return key;
  }
}

/** A date written out with a pattern's tokens (see formatDate). */
export function formatDatePattern(date: Date, pattern: string): string {
  const name = (opts: Intl.DateTimeFormatOptions) => date.toLocaleDateString(undefined, opts);
  const tokens: [string, () => string][] = [
    ["YYYY", () => String(date.getFullYear()).padStart(4, "0")],
    ["YY", () => String(date.getFullYear() % 100).padStart(2, "0")],
    ["MMMM", () => name({ month: "long" })],
    ["MMM", () => name({ month: "short" })],
    ["MM", () => String(date.getMonth() + 1).padStart(2, "0")],
    ["M", () => String(date.getMonth() + 1)],
    ["DD", () => String(date.getDate()).padStart(2, "0")],
    ["D", () => String(date.getDate())],
    ["dddd", () => name({ weekday: "long" })],
    ["ddd", () => name({ weekday: "short" })],
    ["HH", () => pad2(date.getHours())],
    ["H", () => String(date.getHours())],
    ["mm", () => pad2(date.getMinutes())],
    ["ss", () => pad2(date.getSeconds())],
  ];
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "[") {
      const close = pattern.indexOf("]", i);
      if (close !== -1) {
        out += pattern.slice(i + 1, close);
        i = close + 1;
        continue;
      }
    }
    const token = tokens.find(([t]) => pattern.startsWith(t, i));
    if (token) {
      out += token[1]();
      i += token[0].length;
    } else {
      out += pattern[i++];
    }
  }
  return out;
}
