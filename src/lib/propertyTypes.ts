import type { NumberFormat, Property, PropertyConfig, ValueType } from "../types";

// Custom property types: how values display, how typed or pasted text becomes a
// stored value, and how values move between types. Mirrors convert_value and
// parse_number in src-tauri/src/commands/metadata.rs.

export const TYPE_OPTIONS: { type: ValueType; label: string }[] = [
  { type: "free_text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "enum", label: "Dropdown" },
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
export const EXTRACTED_KEYS = new Set([
  "date_taken",
  "camera_make",
  "camera_model",
  "width",
  "height",
  "iso",
  "focal_length",
  "latitude",
  "longitude",
]);

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

/** "YYYY-MM-DD" for ISO and EXIF ("2024:03:01 10:00:00") dates, else null. */
export function dateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})[-:](\d{2})[-:](\d{2})/.exec(value);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseDate(text: string): string | null {
  const key = dateKey(text.trim());
  if (key) return key;
  const t = Date.parse(text);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    const key = dateKey(value);
    if (key) {
      const [y, m, d] = key.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    }
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

/** List values in a cell (Dropdown and Multi-select), as an array. */
export function listValues(value: unknown): string[] {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value.map(valueToText).filter(Boolean) : [valueToText(value)];
}

/** The choices in the header's "+" menu: a type, and the default name of a new column of it. */
export function newPropertyKinds(
  currency: string = defaultCurrency()
): { label: string; type: ValueType; config: PropertyConfig | null }[] {
  return [
    { label: "Text", type: "free_text", config: null },
    { label: "Number", type: "number", config: { format: "generic" } },
    { label: "Currency", type: "number", config: { format: "currency", currency } },
    { label: "Percentage", type: "number", config: { format: "percent" } },
    { label: "Date", type: "date", config: null },
    { label: "Dropdown", type: "enum", config: null },
    { label: "Multi-select", type: "array", config: null },
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
