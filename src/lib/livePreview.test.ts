import { describe, expect, it } from "vitest";
import { isCovered, previewPlace, samplePoints } from "./livePreview";

const rect = { x: 100, y: 50, width: 200, height: 100 };

describe("samplePoints", () => {
  it("samples the centre and just inside each corner", () => {
    expect(samplePoints(rect)).toEqual([
      [200, 100],
      [103, 53],
      [297, 53],
      [103, 147],
      [297, 147],
    ]);
  });
});

describe("isCovered", () => {
  const own = (el: string) => el === "box";

  it("isn't covered when every point hits the box", () => {
    expect(isCovered(rect, () => "box", own)).toBe(false);
  });

  it("is covered when a sheet is over any part of it", () => {
    // A popover over the top right corner only
    const hit = (x: number, y: number) => (x > 250 && y < 80 ? "popover" : "box");
    expect(isCovered(rect, hit, own)).toBe(true);
  });

  it("is covered when a point is off the page", () => {
    expect(isCovered(rect, () => null, own)).toBe(true);
  });
});

describe("previewPlace", () => {
  it("rounds to whole pixels", () => {
    expect(previewPlace({ x: 10.4, y: 20.6, width: 300.5, height: 199.2 })).toEqual({ x: 10, y: 21, width: 301, height: 199 });
  });

  it("gives nothing for a box with no size", () => {
    expect(previewPlace({ x: 10, y: 20, width: 0, height: 100 })).toBeNull();
  });
});
