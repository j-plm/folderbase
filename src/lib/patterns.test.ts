import { describe, it, expect } from "vitest";
import { compilePattern, examplePattern, isPatternError, matchPattern, parseDateAs, type CompiledPattern } from "./patterns";

const compiled = (p: string) => {
  const c = compilePattern(p);
  if (isPatternError(c)) throw new Error(c.error);
  return c as CompiledPattern;
};

describe("compilePattern / matchPattern", () => {
  it("captures slots and matches literals ignoring case", () => {
    expect(matchPattern(compiled("{Date:6}_{Person}.pdf"), "250301_Ruben.PDF")).toEqual({ Date: "250301", Person: "Ruben" });
  });

  it("tries the name without its extension when the pattern has no dot", () => {
    expect(matchPattern(compiled("{Date:6}_{Person}"), "250301_Ruben.pdf")).toEqual({ Date: "250301", Person: "Ruben" });
  });

  it("wildcards match without capturing, fixed or any length", () => {
    expect(matchPattern(compiled("{*}_{Code}_{*}"), "Q3_AB12_final.docx")).toEqual({ Code: "AB12" });
    expect(matchPattern(compiled("{*:2}{Code:4}{*}"), "XXAB12rest.pdf")).toEqual({ Code: "AB12" });
  });

  it("returns null when the name doesn't fit", () => {
    expect(matchPattern(compiled("{Date:6}_{Person}"), "Ruben_250301.pdf")).toBeNull();
    expect(matchPattern(compiled("{Date:6}_{Person}.pdf"), "2503_Ruben.pdf")).toBeNull();
  });

  it("explains mistakes", () => {
    expect(compilePattern("{Code")).toEqual({ error: "A “{” isn't closed" });
    expect(isPatternError(compilePattern("{}"))).toBe(true);
    expect(isPatternError(compilePattern("{A}_{a}"))).toBe(true);
    expect(isPatternError(compilePattern("{A:x}"))).toBe(true);
    expect(isPatternError(compilePattern("x}"))).toBe(true);
  });

  it("treats regex characters as literal text", () => {
    expect(matchPattern(compiled("({Year}) {Title}"), "(2024) Report.pdf")).toEqual({ Year: "2024", Title: "Report" });
  });
});

describe("examplePattern", () => {
  it("generalises around a slot between separators", () => {
    expect(examplePattern("Q3_AB12_final", [{ name: "Code", start: 3, end: 7 }])).toBe("{*}_{Code}_{*}");
  });

  it("fixes lengths where text runs together", () => {
    expect(examplePattern("XXAB12rest", [{ name: "Code", start: 2, end: 6 }])).toBe("{*:2}{Code:4}{*}");
  });

  it("handles several slots, and slots at the ends", () => {
    expect(
      examplePattern("250301_Ruben", [
        { name: "Date", start: 0, end: 6 },
        { name: "Person", start: 7, end: 12 },
      ])
    ).toBe("{Date:digits}_{Person}");
  });

  it("produces a pattern that finds the same values in the example", () => {
    const name = "260901_Vaccinations_Caleb";
    const p = examplePattern(name, [{ name: "Person", start: 20, end: 25 }]);
    expect(p).toBe("{*}_{*}_{Person}");
    expect(matchPattern(compiled(p), `${name}.pdf`)).toEqual({ Person: "Caleb" });
  });
});

describe("parseDateAs", () => {
  const now = new Date("2026-10-18");
  it("reads common formats", () => {
    expect(parseDateAs("250301", "YYMMDD", now)).toBe("2025-03-01");
    expect(parseDateAs("01-03-2025", "DD-MM-YYYY", now)).toBe("2025-03-01");
    expect(parseDateAs("20250301", "YYYYMMDD", now)).toBe("2025-03-01");
  });

  it("reads a time, mm after the hour being the minutes", () => {
    expect(parseDateAs("20240301_101522", "YYYYMMDD_HHmmss", now)).toBe("2024-03-01T10:15:22");
    expect(parseDateAs("2024-03-01 10.15.22", "YYYY-MM-DD HH.mm.ss", now)).toBe("2024-03-01T10:15:22");
    expect(parseDateAs("202403011015", "YYYYMMDDHHmm", now)).toBe("2024-03-01T10:15:00");
    expect(parseDateAs("20240301", "yyyymmdd", now)).toBe("2024-03-01");
    expect(parseDateAs("20240301_251522", "YYYYMMDD_HHmmss", now)).toBeNull();
    expect(parseDateAs("20240301_106022", "YYYYMMDD_HHmmss", now)).toBeNull();
  });

  it("reads past milliseconds, and reads a UTC time as local time", () => {
    expect(parseDateAs("20250610_094446600", "YYYYMMDD_HHmmssSSS", now)).toBe("2025-06-10T09:44:46");
    const local = new Date(Date.UTC(2025, 5, 10, 9, 44, 46));
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`;
    expect(parseDateAs("20250610_094446600", "YYYYMMDD_HHmmssSSS (UTC)", now)).toBe(expected);
    expect(parseDateAs("20250610_094446600", "YYYYMMDD_HHmmssSSS UTC", now)).toBe(expected);
    expect(parseDateAs("20250610_09444660", "YYYYMMDD_HHmmssSSS (UTC)", now)).toBeNull();
  });

  it("puts two-digit years in the right century", () => {
    expect(parseDateAs("990101", "YYMMDD", now)).toBe("1999-01-01");
    expect(parseDateAs("360101", "YYMMDD", now)).toBe("2036-01-01");
  });

  it("refuses text that doesn't fit or isn't a real date", () => {
    expect(parseDateAs("2503", "YYMMDD", now)).toBeNull();
    expect(parseDateAs("250231", "YYMMDD", now)).toBeNull();
    expect(parseDateAs("251301", "YYMMDD", now)).toBeNull();
  });
});

describe("kinds of character", () => {
  it("takes only digits, letters, capitals or small letters", () => {
    expect(matchPattern(compiled("{Test:digits}-{Rest}"), "0014-250701")).toEqual({ Test: "0014", Rest: "250701" });
    expect(matchPattern(compiled("{Test:4 digits}-{Date:6 digits}"), "0014-250701")).toEqual({ Test: "0014", Date: "250701" });
    expect(matchPattern(compiled("{Test:4 digits}-{Date:6 digits}"), "00A4-250701")).toBeNull();
    expect(matchPattern(compiled("{Code:upper}{Num:digits}"), "AB12.pdf")).toEqual({ Code: "AB", Num: "12" });
    expect(matchPattern(compiled("{Code:upper}{Num:digits}"), "ab12.pdf")).toBeNull();
    expect(matchPattern(compiled("{Word:lower}"), "report")).toEqual({ Word: "report" });
    expect(matchPattern(compiled("{Name:letters}_{*}"), "Ruben_2024")).toEqual({ Name: "Ruben" });
    expect(matchPattern(compiled("{Id:alnum}"), "AB12")).toEqual({ Id: "AB12" });
  });

  it("splits runs of different kinds without separators", () => {
    expect(matchPattern(compiled("{Letters:letters}{Digits:digits}"), "Rig42")).toEqual({ Letters: "Rig", Digits: "42" });
  });

  it("finds text anywhere with wildcards either side", () => {
    expect(matchPattern(compiled("{*}invoice{*}"), "2024_Acme_Invoice_v2.pdf")).toEqual({});
    expect(matchPattern(compiled("{*}invoice{*}"), "2024_Acme_receipt.pdf")).toBeNull();
    expect(matchPattern(compiled("{*:digits}"), "2024")).toEqual({});
  });

  it("keeps literals case-insensitive", () => {
    expect(matchPattern(compiled("RIG_{N:digits}"), "rig_7")).toEqual({ N: "7" });
  });

  it("explains a kind it doesn't know", () => {
    expect(compilePattern("{X:vowels}")).toEqual({ error: "{X:vowels}: “vowels” isn't a kind: use digits, letters, upper, lower or alnum" });
    expect(isPatternError(compilePattern("{X:0}"))).toBe(true);
    expect(isPatternError(compilePattern("{X:4 digit}"))).toBe(false);
  });

  it("marks picked digits as digits", () => {
    expect(examplePattern("0014-250701", [{ name: "Test", start: 0, end: 4 }, { name: "Date", start: 5, end: 11 }])).toBe("{Test:digits}-{Date:digits}");
    expect(examplePattern("Rig42x", [{ name: "N", start: 3, end: 5 }])).toBe("{*:3}{N:2 digits}{*}");
  });
});
