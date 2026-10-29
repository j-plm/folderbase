import { describe, expect, it } from "vitest";
import { dragItemsFor, edgeScroll } from "./fileDrag";
import type { FileRecord } from "../types";

const file = (id: string): FileRecord => ({
  file_id: id,
  file_path: `/root/${id}.pdf`,
  file_type: "application/pdf",
  timestamp: null,
  library: "docs",
  metadata: {},
  tags: [],
});

describe("dragItemsFor", () => {
  const files = [file("1"), file("2")];
  const folderPath = (id: string) => (id === "folder:Acme" ? ["2024", "Acme"] : null);

  it("carries files from the folder showing them, and folders as their paths", () => {
    expect(dragItemsFor(["folder:Acme", "2"], files, ["2024"], folderPath)).toEqual([
      { kind: "folder", path: ["2024", "Acme"] },
      { kind: "file", file: files[1], from: ["2024"] },
    ]);
  });

  it("leaves out ids no longer shown", () => {
    expect(dragItemsFor(["9"], files, [], folderPath)).toEqual([]);
  });
});

describe("edgeScroll", () => {
  const rect = { left: 0, top: 100, right: 400, bottom: 500 };

  it("scrolls up near the top and down near the bottom, faster nearer the edge", () => {
    expect(edgeScroll(rect, 200, 101).dy).toBeLessThan(edgeScroll(rect, 200, 120).dy);
    expect(edgeScroll(rect, 200, 101).dy).toBeLessThan(0);
    expect(edgeScroll(rect, 200, 499).dy).toBeGreaterThan(0);
    expect(edgeScroll(rect, 200, 101).dy).toBeGreaterThanOrEqual(-18);
  });

  it("scrolls sideways near the sides", () => {
    expect(edgeScroll(rect, 2, 300)).toEqual({ dx: expect.any(Number), dy: 0 });
    expect(edgeScroll(rect, 2, 300).dx).toBeLessThan(0);
    expect(edgeScroll(rect, 398, 300).dx).toBeGreaterThan(0);
  });

  it("doesn't scroll away from the edges, outside the area, or in one too small to have a middle", () => {
    expect(edgeScroll(rect, 200, 300)).toEqual({ dx: 0, dy: 0 });
    expect(edgeScroll(rect, 200, 50)).toEqual({ dx: 0, dy: 0 });
    expect(edgeScroll({ left: 0, top: 0, right: 40, bottom: 40 }, 20, 2)).toEqual({ dx: 0, dy: 0 });
  });
});
