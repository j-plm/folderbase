import { describe, expect, it } from "vitest";
import type { FileRecord } from "../types";
import { DEFAULT_ARRANGEMENT } from "./arrange";
import {
  arrangeColumn,
  fileNode,
  inheritWidths,
  navigate,
  resolveColumns,
  selectAt,
  type BrowserNode,
} from "./columnBrowser";

function file(path: string): FileRecord {
  return { file_id: path, file_path: path, file_type: null, timestamp: null, library: null, metadata: null, tags: [] };
}

// Tree:  Cars/ { Hyundai/ { a.pdf }, b.pdf },  z.pdf,  c.pdf
const tree: BrowserNode[] = [
  fileNode(file("/z.pdf")),
  {
    id: "cars",
    name: "Cars",
    children: [
      { id: "hyundai", name: "Hyundai", children: [fileNode(file("/a.pdf"))] },
      fileNode(file("/b.pdf")),
    ],
  },
  fileNode(file("/c.pdf")),
];

describe("resolveColumns", () => {
  it("opens a column for each selected folder", () => {
    const { columns, selected } = resolveColumns(tree, ["cars", "hyundai", "/a.pdf"]);
    expect(columns).toHaveLength(3);
    expect(columns[2].map((n) => n.id)).toEqual(["/a.pdf"]);
    expect(selected.map((n) => n.id)).toEqual(["cars", "hyundai", "/a.pdf"]);
  });

  it("stops at a selected file or an unknown id", () => {
    expect(resolveColumns(tree, ["/z.pdf"]).columns).toHaveLength(1);
    expect(resolveColumns(tree, ["cars", "gone"]).columns).toHaveLength(2);
  });
});

describe("selectAt", () => {
  it("replaces the selection from that column onwards", () => {
    expect(selectAt(["cars", "hyundai", "/a.pdf"], 1, "/b.pdf")).toEqual(["cars", "/b.pdf"]);
    expect(selectAt(["cars", "hyundai"], 1, null)).toEqual(["cars"]);
  });
});

describe("inheritWidths", () => {
  it("gives new columns the width of the column to their left", () => {
    expect(inheritWidths([300], 0, 3, 260)).toEqual([300, 300, 300]);
    expect(inheritWidths([], 0, 2, 260)).toEqual([260, 260]);
  });

  it("re-inherits columns after the one whose selection changed", () => {
    expect(inheritWidths([200, 350, 400], 0, 3, 260)).toEqual([200, 200, 200]);
    expect(inheritWidths([200, 350, 400], 1, 3, 260)).toEqual([200, 350, 350]);
  });
});

describe("arrangeColumn", () => {
  it("keeps folders on top, then sorted files", () => {
    const groups = arrangeColumn(tree, DEFAULT_ARRANGEMENT);
    expect(groups).toHaveLength(1);
    expect(groups[0].nodes.map((n) => n.name)).toEqual(["Cars", "c.pdf", "z.pdf"]);
  });

  it("gives folders their own group when grouping", () => {
    const groups = arrangeColumn(tree, { ...DEFAULT_ARRANGEMENT, groupBy: "name" });
    expect(groups.map((g) => g.label)).toEqual(["Folders", "C", "Z"]);
  });
});

describe("navigate", () => {
  const ordered = (path: string[]) =>
    resolveColumns(tree, path).columns.map((c) => arrangeColumn(c, DEFAULT_ARRANGEMENT).flatMap((g) => g.nodes));

  it("moves within the active column", () => {
    expect(navigate([], ordered([]), "ArrowDown")).toEqual(["cars"]);
    expect(navigate(["cars"], ordered(["cars"]), "ArrowDown")).toEqual(["/c.pdf"]);
    expect(navigate(["cars"], ordered(["cars"]), "ArrowUp")).toEqual(["cars"]);
  });

  it("enters folders with Right and leaves with Left", () => {
    expect(navigate(["cars"], ordered(["cars"]), "ArrowRight")).toEqual(["cars", "hyundai"]);
    expect(navigate(["cars", "hyundai"], ordered(["cars", "hyundai"]), "ArrowLeft")).toEqual(["cars"]);
    expect(navigate(["/c.pdf"], ordered(["/c.pdf"]), "ArrowRight")).toEqual(["/c.pdf"]);
  });
});
