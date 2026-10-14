import { describe, expect, it } from "vitest";
import { middleTruncate, twoLineLabel } from "./tileLabel";

const mono = (s: string) => s.length * 10; // 10px per character

describe("twoLineLabel", () => {
  it("keeps short names on one line", () => {
    expect(twoLineLabel("lib.rs", 100, mono)).toEqual(["lib.rs"]);
  });

  it("breaks at a space when one fits on the first line", () => {
    expect(twoLineLabel("Private & Shared", 100, mono)).toEqual(["Private &", "Shared"]);
  });

  it("breaks mid-word when there is no space", () => {
    expect(twoLineLabel("Gemini_Generated", 100, mono)).toEqual(["Gemini_Gen", "erated"]);
  });

  it("truncates the second line in the middle, keeping the extension", () => {
    const [first, second] = twoLineLabel("New Motion Labs 000817_disclaimer.pdf", 100, mono);
    expect(first).toBe("New Motion");
    expect(second.endsWith("imer.pdf")).toBe(true);
    expect(second).toContain("…");
    expect(mono(second)).toBeLessThanOrEqual(100);
  });
});

describe("middleTruncate", () => {
  it("leaves names that fit alone", () => {
    expect(middleTruncate("Waves", 100, mono)).toBe("Waves");
  });

  it("keeps both ends with an ellipsis in the middle", () => {
    const out = middleTruncate("NewMotionLabs-Track-Chairing", 150, mono);
    expect(out).toContain("…");
    expect(out.startsWith("NewMot")).toBe(true);
    expect(out.endsWith("airing")).toBe(true);
    expect(mono(out)).toBeLessThanOrEqual(150);
  });
});
