import { describe, expect, it } from "vitest";
import { formatBytes, launchLocation, mappingSummary, outermost, rulesSummary } from "./settingsText";

describe("formatBytes", () => {
  it("uses Finder's decimal units", () => {
    expect(formatBytes(0)).toBe("Zero bytes");
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(1_500)).toBe("2 KB");
    expect(formatBytes(2_340_000)).toBe("2.3 MB");
    expect(formatBytes(4_000_000_000)).toBe("4 GB");
    expect(formatBytes(150_000_000)).toBe("150 MB");
  });
});

describe("mappingSummary", () => {
  it("counts levels, not folders", () => {
    expect(mappingSummary([])).toBe("Nothing mapped");
    expect(mappingSummary([{ depth: 1 }, { depth: 1 }])).toBe("1 level mapped");
    expect(mappingSummary([{ depth: 1 }, { depth: 2 }, { depth: 3 }, { depth: 2 }])).toBe("3 levels mapped");
  });
});

describe("rulesSummary", () => {
  it("says how many rules are on", () => {
    expect(rulesSummary([])).toBe("No rules");
    expect(rulesSummary([{ enabled: true }])).toBe("1 rule, on");
    expect(rulesSummary([{ enabled: false }])).toBe("1 rule, off");
    expect(rulesSummary([{ enabled: true }, { enabled: true }, { enabled: true }, { enabled: false }])).toBe("4 rules, 3 on");
    expect(rulesSummary([{ enabled: true }, { enabled: true }])).toBe("2 rules, all on");
    expect(rulesSummary([{ enabled: false }, { enabled: false }])).toBe("2 rules, all off");
  });
});

describe("outermost", () => {
  it("drops folders inside others in the list", () => {
    expect(outermost(["/a/b", "/a/b/c", "/a/d"])).toEqual(["/a/b", "/a/d"]);
    expect(outermost(["/a/bc", "/a/b"])).toEqual(["/a/bc", "/a/b"]);
    expect(outermost(["C:\\x", "C:\\x\\y"])).toEqual(["C:\\x"]);
  });
});

describe("launchLocation", () => {
  it("opens the last location while it's there, else the first", () => {
    expect(launchLocation("last", ["a", "b"], "b")).toBe("b");
    expect(launchLocation("last", ["a", "b"], "gone")).toBe("a");
    expect(launchLocation("last", ["a", "b"], null)).toBe("a");
    expect(launchLocation("first", ["a", "b"], "b")).toBe("a");
    expect(launchLocation("first", [], null)).toBeNull();
  });
});
