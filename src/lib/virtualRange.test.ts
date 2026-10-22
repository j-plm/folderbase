import { describe, expect, it } from "vitest";
import { scrollAheadIndexes } from "./virtualRange";

const range = (startIndex: number, endIndex: number, count = 1000, overscan = 0) => ({ startIndex, endIndex, overscan, count });
const bounds = (xs: number[]) => [xs[0], xs[xs.length - 1]];

describe("scrollAheadIndexes", () => {
  it("renders a screen either side when idle", () => {
    expect(bounds(scrollAheadIndexes(range(100, 129), null))).toEqual([70, 159]);
  });

  it("renders a second screen ahead in the scroll direction", () => {
    expect(bounds(scrollAheadIndexes(range(100, 129), "forward"))).toEqual([70, 189]);
    expect(bounds(scrollAheadIndexes(range(100, 129), "backward"))).toEqual([40, 159]);
  });

  it("stays within the list", () => {
    expect(bounds(scrollAheadIndexes(range(0, 29, 50), "forward"))).toEqual([0, 49]);
    expect(scrollAheadIndexes(range(0, 0, 1), "backward")).toEqual([0]);
  });

  it("treats overscan as the smallest screen", () => {
    expect(bounds(scrollAheadIndexes(range(100, 101, 1000, 10), null))).toEqual([90, 111]);
  });
});
