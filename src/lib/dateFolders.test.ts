import { describe, expect, it } from "vitest";
import { dateFolder, dateFolderRange, defaultDateUnit, dateUnitsFor } from "./dateFolders";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("dateFolder", () => {
  it("makes a folder of each unit", () => {
    const at = (unit: Parameters<typeof dateFolder>[1]) => dateFolder("2024-03-12", unit);
    expect(at("year")).toEqual({ value: "2024", label: "2024", rank: 2024 });
    expect(at("quarter")).toEqual({ value: "2024-Q1", label: "Q1 2024", rank: "2024-1" });
    expect(at("month").label).toBe("March 2024");
    expect(at("month").value).toBe("2024-03");
    expect(at("week")).toMatchObject({ value: "2024-W11", label: "Week 11, 2024" });
    expect(at("day")).toMatchObject({ value: "2024-03-12", label: "12 March 2024" });
    expect(at("quarterOfYear").label).toBe("Q1");
    expect(at("monthOfYear")).toMatchObject({ value: "03", label: "March", rank: 3 });
    expect(at("weekOfYear").label).toBe("Week 11");
    expect(at("weekday")).toMatchObject({ value: "2", label: "Tuesday", rank: 2 });
  });

  it("puts a day in its ISO week, which can belong to the year next door", () => {
    expect(dateFolder("2024-12-30", "week").value).toBe("2025-W01");
    expect(dateFolder("2021-01-03", "week").value).toBe("2020-W53");
  });
});

describe("dateFolderRange", () => {
  it("spans the days of a folder", () => {
    const range = (value: string, unit: Parameters<typeof dateFolderRange>[1]) => dateFolderRange(value, unit)?.map(ymd);
    expect(range("2024", "year")).toEqual(["2024-01-01", "2025-01-01"]);
    expect(range("2024-Q4", "quarter")).toEqual(["2024-10-01", "2025-01-01"]);
    expect(range("2024-02", "month")).toEqual(["2024-02-01", "2024-03-01"]);
    expect(range("2024-W11", "week")).toEqual(["2024-03-11", "2024-03-18"]);
    expect(range("2025-W01", "week")).toEqual(["2024-12-30", "2025-01-06"]);
    expect(range("2024-03-12", "day")).toEqual(["2024-03-12", "2024-03-13"]);
  });

  it("has no range for folders that repeat", () => {
    expect(dateFolderRange("03", "monthOfYear")).toBeNull();
    expect(dateFolderRange("2", "weekday")).toBeNull();
  });
});

describe("units", () => {
  it("offers Finder's buckets only for the file's own dates", () => {
    expect(defaultDateUnit("created")).toBe("relative");
    expect(defaultDateUnit("prop:Due")).toBe("month");
    expect(dateUnitsFor("prop:Due").some((u) => u.unit === "relative")).toBe(false);
    expect(dateUnitsFor("modified")[0].unit).toBe("relative");
  });
});
