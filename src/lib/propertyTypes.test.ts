import { describe, expect, it } from "vitest";
import { coerceValue, dateConfig, dateKey, dateTimeKey, defaultCurrency, editText, formatValue, parseInput, parseNumber, uniqueName, valueToText } from "./propertyTypes";

describe("parseNumber", () => {
  it("reads separators, currency symbols and percentages", () => {
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber("£12.50")).toBe(12.5);
    expect(parseNumber("25%")).toBe(0.25);
    expect(parseNumber("-3")).toBe(-3);
  });
  it("rejects words containing digits and empty text", () => {
    expect(parseNumber("Rig 2")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("parseInput", () => {
  it("clears on empty text", () => {
    expect(parseInput("  ", "free_text")).toBeNull();
  });
  it("stores numbers as numbers, percent column treating 25 as 25%", () => {
    expect(parseInput("42", "number")).toBe(42);
    expect(parseInput("25", "number", { format: "percent" })).toBe(0.25);
    expect(parseInput("25%", "number", { format: "percent" })).toBe(0.25);
  });
  it("keeps text that isn't a number as typed", () => {
    expect(parseInput("tbc", "number")).toBe("tbc");
  });
  it("normalises dates to YYYY-MM-DD, keeping a time when there is one", () => {
    expect(parseInput("2024-03-01", "date")).toBe("2024-03-01");
    expect(parseInput("2024:03:01 10:00:00", "date")).toBe("2024-03-01T10:00:00");
    expect(parseInput("2024-03-01T10:15", "date")).toBe("2024-03-01T10:15:00");
    expect(parseInput("1 March 2024 10:15", "date")).toBe("2024-03-01T10:15:00");
    expect(parseInput("1 March 2024", "date")).toBe("2024-03-01");
  });
  it("splits multi-select text on commas, dropping blanks and repeats", () => {
    expect(parseInput("Apollo, Hermes,,Apollo", "array")).toEqual(["Apollo", "Hermes"]);
  });
});

describe("coerceValue", () => {
  it("keeps lists for multi-select and joins them for text", () => {
    expect(coerceValue(["A", "B"], "array")).toEqual(["A", "B"]);
    expect(coerceValue(["A", "B"], "free_text")).toBe("A, B");
  });
  it("wraps single values for multi-select and parses text for numbers", () => {
    expect(coerceValue("A", "array")).toEqual(["A"]);
    expect(coerceValue("12", "number")).toBe(12);
    expect(coerceValue(null, "number")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats currency and percentages", () => {
    expect(formatValue(12.5, "number", { format: "currency", currency: "GBP" })).toContain("12.50");
    expect(formatValue(0.25, "number", { format: "percent" })).toContain("25");
  });
  it("shows text kept in a number column as it is", () => {
    expect(formatValue("tbc", "number")).toBe("tbc");
  });
  it("edits percentages as the number typed", () => {
    expect(editText(0.25, "number", { format: "percent" })).toBe("25");
  });
  it("copies lists as comma-separated text", () => {
    expect(valueToText(["A", "B"])).toBe("A, B");
    expect(valueToText(null)).toBe("");
  });
  it("reads ISO and EXIF dates", () => {
    expect(dateKey("2024-03-01T10:00:00Z")).toBe("2024-03-01");
    expect(dateKey("2024:03:01 10:00:00")).toBe("2024-03-01");
    expect(dateKey("March")).toBeNull();
  });
  it("keeps a date's time: clock time as written, a moment in local time", () => {
    expect(dateTimeKey("2024-03-01")).toBe("2024-03-01");
    expect(dateTimeKey("2024:03:01 10:00:00")).toBe("2024-03-01T10:00:00");
    expect(dateTimeKey("2024-03-01T10:15")).toBe("2024-03-01T10:15:00");
    const moment = new Date("2024-03-01T23:30:00Z");
    expect(dateTimeKey("2024-03-01T23:30:00+00:00")).toBe(dateTimeKey(
      `${moment.getFullYear()}-${String(moment.getMonth() + 1).padStart(2, "0")}-${String(moment.getDate()).padStart(2, "0")}T${String(moment.getHours()).padStart(2, "0")}:30:00`
    ));
    expect(dateTimeKey("2024-03-01T23:30:00.123Z")).toBe(dateTimeKey("2024-03-01T23:30:00Z"));
    // Keys sort as text: a day alone before the same day with a time
    expect(["2024-03-01T09:00:00", "2024-03-01", "2024-02-28T23:00:00"].sort()).toEqual(["2024-02-28T23:00:00", "2024-03-01", "2024-03-01T09:00:00"]);
  });
});

describe("defaultCurrency", () => {
  it("picks the region's currency, falling back to USD", () => {
    expect(defaultCurrency("en-GB")).toBe("GBP");
    expect(defaultCurrency("fr-FR")).toBe("EUR");
    expect(defaultCurrency("en")).toBe("USD");
  });
});

describe("uniqueName", () => {
  it("uses the type name when free, else the next free number", () => {
    expect(uniqueName("Text", [])).toBe("Text");
    expect(uniqueName("Text", ["text", "Text 2"])).toBe("Text 3");
    expect(uniqueName("Date", ["Text"])).toBe("Date");
  });
});

describe("date formats", () => {
  // Locale-dependent formats are checked loosely; ISO, relative and patterns exactly
  const now = new Date(2026, 9, 18);
  it("writes ISO and custom patterns", async () => {
    const { formatDate, formatDatePattern } = await import("./propertyTypes");
    expect(formatDate("2025-03-01", "iso")).toBe("2025-03-01");
    expect(formatDatePattern(new Date(2025, 2, 1), "DD/MM/YYYY")).toBe("01/03/2025");
    expect(formatDatePattern(new Date(2025, 2, 1), "D.M.YY")).toBe("1.3.25");
    expect(formatDatePattern(new Date(2025, 2, 1), "YYYY-MM-DD [week]")).toBe("2025-03-01 week");
    expect(formatDate("2025-03-01", "custom:YYYYMMDD")).toBe("20250301");
  });

  it("reads close dates relatively, and the rest as dates", async () => {
    const { formatDate } = await import("./propertyTypes");
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    expect(formatDate("2026-10-17", "relative", now)).toBe(rtf.format(-1, "day"));
    expect(formatDate("2026-10-21", "relative", now)).toBe(rtf.format(3, "day"));
    expect(formatDate("2025-03-01", "relative", now)).toContain("2025");
  });

  it("defaults to the medium style, and shows dates through formatValue", async () => {
    const { formatDate, formatValue } = await import("./propertyTypes");
    expect(formatDate("2025-03-01", undefined)).toBe(formatDate("2025-03-01", "medium"));
    expect(formatValue("2025-03-01", "date", { dateFormat: "iso" })).toBe("2025-03-01");
  });

  it("shows a date's time, as Finder does, unless Show Time is off", async () => {
    const { formatDate, formatDatePattern, formatValue } = await import("./propertyTypes");
    const time = new Date(2025, 2, 1, 10, 15).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    expect(formatValue("2025-03-01T10:15:22", "date", {})).toBe(`${formatDate("2025-03-01", "medium")} at ${time}`);
    expect(formatValue("2025-03-01T10:15:22", "date", { dateFormat: "iso" })).toBe("2025-03-01 10:15:22");
    expect(formatValue("2025-03-01T10:15:22", "date", { hideTime: true })).toBe(formatDate("2025-03-01", "medium"));
    expect(formatValue("2025-03-01T10:15:22", "date", { dateFormat: "custom:YYYYMMDD" })).toBe("20250301");
    expect(formatDatePattern(new Date(2025, 2, 1, 9, 5, 7), "DD/MM/YYYY HH:mm:ss H")).toBe("01/03/2025 09:05:07 9");
  });

  it("stores only the Date settings that differ from the defaults", () => {
    expect(dateConfig({ dateFormat: "medium" })).toBeNull();
    expect(dateConfig({ dateFormat: "iso", hideTime: false })).toEqual({ dateFormat: "iso" });
    expect(dateConfig({ hideTime: true })).toEqual({ hideTime: true });
  });
});
