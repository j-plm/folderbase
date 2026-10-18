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
    ).toBe("{Date}_{Person}");
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
