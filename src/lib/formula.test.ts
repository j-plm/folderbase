import { describe, it, expect } from "vitest";
import { FormulaError, formulaProblem, runFormula, type FormulaContext } from "./formula";

const ctx: FormulaContext = {
  name: "Q3_AB12_final",
  filename: "Q3_AB12_final.docx",
  ext: "docx",
  path: "Clients/Acme/Q3_AB12_final.docx",
  folder: "Acme",
  slots: { Code: "ab12", Date: "250301" },
  prop: (n) => ({ Client: "Acme" })[n] ?? "",
};
const run = (f: string) => runFormula(f, ctx);

describe("runFormula", () => {
  it("slices by position, as Notion does (0 is the first character)", () => {
    expect(run("slice(name, 3, 7)")).toBe("AB12");
    expect(run("slice(name, 8)")).toBe("final");
    expect(run("left(name, 2)")).toBe("Q3");
    expect(run("right(filename, 4)")).toBe("docx");
  });

  it("cuts around separators", () => {
    expect(run('before(name, "_")')).toBe("Q3");
    expect(run('after(name, "_")')).toBe("AB12_final");
    expect(run('afterLast(name, "_")')).toBe("final");
    expect(run('beforeLast(name, "_")')).toBe("Q3_AB12");
    expect(run('before(name, "#")')).toBe("");
  });

  it("matches and replaces with regular expressions", () => {
    expect(run('match(name, "_([A-Z]{2}\\d{2})_")')).toBe("AB12");
    expect(run('match(name, "[0-9]+")')).toBe("3");
    expect(run('replace(name, "_", " ")')).toBe("Q3 AB12 final");
  });

  it("uses slots, properties and names, joined with &", () => {
    expect(run('prop("Client") & "-" & upper({Code})')).toBe("Acme-AB12");
    expect(run("folder & \"/\" & ext")).toBe("Acme/docx");
    expect(run('date({Date}, "YYMMDD")')).toBe("2025-03-01");
    expect(run("trim(lower(\"  ABC \"))")).toBe("abc");
  });

  it("explains mistakes", () => {
    expect(() => run("{Nope}")).toThrow(FormulaError);
    expect(() => run("nothing")).toThrow(/isn't known/);
    expect(() => run("frobnicate(name)")).toThrow(/no function/);
    expect(() => run("left(name)")).toThrow(/first n characters/);
    expect(() => run('match(name, "(")')).toThrow(/valid regular expression/);
    expect(formulaProblem('upper("x"')).toMatch(/Expected/);
    expect(formulaProblem('"open')).toMatch(/isn't closed/);
    expect(formulaProblem("upper(name)")).toBeNull();
  });
});
