import { PROP_PREFIX, propName } from "./fileColumns";
import { MONTH_NAMES } from "./fileValues";
import type { ValueType } from "../types";

// Folders made of a date (a date property, Created, Modified): the date's
// year, quarter, month, week or day, or the part of the year or week it
// falls in, without a property for each. Pure.

/**
 * What a date level's folders are. "relative" is Finder's (Today, Previous 7
 * Days, then years), for Created and Modified only. The "...Of" units repeat
 * every year or week, so they make sense below a level that splits by year.
 */
export type DateUnit =
  | "relative"
  | "year"
  | "quarter"
  | "month"
  | "week"
  | "day"
  | "quarterOfYear"
  | "monthOfYear"
  | "weekOfYear"
  | "weekday";

export const DATE_UNITS: { unit: DateUnit; label: string; example: string }[] = [
  { unit: "relative", label: "As Finder Does", example: "Today, Previous 7 Days, 2023" },
  { unit: "year", label: "Year", example: "2024" },
  { unit: "quarter", label: "Quarter", example: "Q1 2024" },
  { unit: "month", label: "Month", example: "March 2024" },
  { unit: "week", label: "Week", example: "Week 12, 2024" },
  { unit: "day", label: "Day", example: "12 March 2024" },
  { unit: "quarterOfYear", label: "Quarter of the Year", example: "Q1" },
  { unit: "monthOfYear", label: "Month of the Year", example: "March" },
  { unit: "weekOfYear", label: "Week of the Year", example: "Week 12" },
  { unit: "weekday", label: "Day of the Week", example: "Monday" },
];

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Whether a column's folders are dates: a date property, Created or Modified. */
export function isDateColumn(column: string, typeOf: (name: string) => ValueType): boolean {
  if (column === "created" || column === "modified") return true;
  return column.startsWith(PROP_PREFIX) && typeOf(propName(column)) === "date";
}

/** A date level's unit when it hasn't chosen one: Finder's buckets for Created and Modified, months for a date property. */
export function defaultDateUnit(column: string): DateUnit {
  return column === "created" || column === "modified" ? "relative" : "month";
}

/** The units a column offers: Finder's buckets only for the file's own dates. */
export function dateUnitsFor(column: string): typeof DATE_UNITS {
  return column === "created" || column === "modified" ? DATE_UNITS : DATE_UNITS.filter((u) => u.unit !== "relative");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO 8601 week: the week (Monday first) and the year it belongs to. */
function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return { year, week };
}

/**
 * The folder a day ("2024-03-12") goes in for a unit: its value (what keeps
 * its branch and pins, unchanged by wording), label and rank.
 */
export function dateFolder(ymd: string, unit: Exclude<DateUnit, "relative">): { value: string; label: string; rank: string | number } {
  const [y, m, d] = ymd.split("-").map(Number);
  const quarter = Math.floor((m - 1) / 3) + 1;
  switch (unit) {
    case "year":
      return { value: String(y), label: String(y), rank: y };
    case "quarter":
      return { value: `${y}-Q${quarter}`, label: `Q${quarter} ${y}`, rank: `${y}-${quarter}` };
    case "month":
      return { value: `${y}-${pad(m)}`, label: `${MONTH_NAMES[m - 1]} ${y}`, rank: `${y}-${pad(m)}` };
    case "week": {
      const w = isoWeek(y, m, d);
      return { value: `${w.year}-W${pad(w.week)}`, label: `Week ${w.week}, ${w.year}`, rank: `${w.year}-${pad(w.week)}` };
    }
    case "day":
      return { value: ymd, label: `${d} ${MONTH_NAMES[m - 1]} ${y}`, rank: ymd };
    case "quarterOfYear":
      return { value: `Q${quarter}`, label: `Q${quarter}`, rank: quarter };
    case "monthOfYear":
      return { value: pad(m), label: MONTH_NAMES[m - 1], rank: m };
    case "weekOfYear": {
      const { week } = isoWeek(y, m, d);
      return { value: `W${pad(week)}`, label: `Week ${week}`, rank: week };
    }
    case "weekday": {
      const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
      return { value: String(day), label: WEEKDAYS[day - 1], rank: day };
    }
  }
}

/**
 * The days a date folder spans, as [first, end) (local dates), for filtering
 * to it. Null for the units that repeat (a month of every year) and Finder's.
 */
export function dateFolderRange(value: string, unit: DateUnit): [Date, Date] | null {
  let match: RegExpExecArray | null;
  switch (unit) {
    case "year":
      if (!/^\d{4}$/.test(value)) return null;
      return [new Date(Number(value), 0, 1), new Date(Number(value) + 1, 0, 1)];
    case "quarter":
      if (!(match = /^(\d{4})-Q([1-4])$/.exec(value))) return null;
      return [new Date(Number(match[1]), (Number(match[2]) - 1) * 3, 1), new Date(Number(match[1]), Number(match[2]) * 3, 1)];
    case "month":
      if (!(match = /^(\d{4})-(\d{2})$/.exec(value))) return null;
      return [new Date(Number(match[1]), Number(match[2]) - 1, 1), new Date(Number(match[1]), Number(match[2]), 1)];
    case "week": {
      if (!(match = /^(\d{4})-W(\d{2})$/.exec(value))) return null;
      // The Monday of ISO week 1 is the one on or before 4 January
      const jan4 = new Date(Number(match[1]), 0, 4);
      const monday = new Date(jan4.getFullYear(), 0, 4 - ((jan4.getDay() || 7) - 1) + (Number(match[2]) - 1) * 7);
      return [monday, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7)];
    }
    case "day": {
      if (!(match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value))) return null;
      const first = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return [first, new Date(first.getFullYear(), first.getMonth(), first.getDate() + 1)];
    }
    default:
      return null;
  }
}
