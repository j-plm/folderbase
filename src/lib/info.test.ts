import { describe, expect, it } from "vitest";
import {
  editsBefore,
  infoTitle,
  informationRows,
  listEdits,
  mediaRows,
  sameText,
  selectionSummary,
  setEdits,
  sharedValue,
  showMore,
  sizeWithBytes,
  valueCounts,
} from "./info";
import type { FileRecord } from "../types";

const file = (id: string, metadata: Record<string, unknown>, size = 1000): FileRecord => ({
  file_id: id,
  file_path: `/root/${id}.pdf`,
  file_type: "application/pdf",
  timestamp: null,
  library: "docs",
  metadata,
  tags: [],
  file_size: size,
});

const read = (key: string) => (f: FileRecord) => (f.metadata ?? {})[key];

describe("summing up", () => {
  it("titles one file by name and several by count", () => {
    expect(infoTitle([file("a", {})])).toBe("a.pdf");
    expect(infoTitle([file("a", {}), file("b", {})])).toBe("2 items");
    expect(infoTitle([])).toBe("No Selection");
  });

  it("adds up the sizes of a selection", () => {
    expect(selectionSummary([file("a", {}, 2_000_000), file("b", {}, 400_000)])).toBe("2 items, 2.4 MB");
    expect(selectionSummary([file("a", {}, 0)])).toBe("1 item, Zero bytes");
  });

  it("shows exact bytes beside a size", () => {
    expect(sizeWithBytes(12_422_104)).toBe("12.4 MB (12,422,104 bytes)");
    expect(sizeWithBytes(512)).toBe("512 bytes");
    expect(sizeWithBytes(null)).toBe("--");
  });
});

describe("sharedValue", () => {
  it("gives the value every file holds", () => {
    const files = [file("a", { Client: "Acme" }), file("b", { Client: "Acme" })];
    expect(sharedValue(files, read("Client"), "enum")).toEqual({ kind: "same", value: "Acme" });
  });

  it("is mixed where files differ, empty counting as a value", () => {
    expect(sharedValue([file("a", { Client: "Acme" }), file("b", {})], read("Client"), "enum")).toEqual({ kind: "mixed" });
  });

  it("treats Multi-select values in any order as the same", () => {
    const files = [file("a", { P: ["x", "y"] }), file("b", { P: ["y", "x"] })];
    expect(sharedValue(files, read("P"), "array").kind).toBe("same");
  });

  it("treats every kind of empty as the same nothing", () => {
    const files = [file("a", { P: [] }), file("b", { P: "" }), file("c", {})];
    expect(sharedValue(files, read("P"), "array")).toEqual({ kind: "same", value: null });
  });
});

describe("bulk edits", () => {
  const files = [file("a", { P: ["x"], C: "Acme" }), file("b", { P: ["x", "y"] }), file("c", {})];

  it("counts how many files hold each list value", () => {
    expect(valueCounts(files, read("P"))).toEqual([
      { value: "x", count: 2 },
      { value: "y", count: 1 },
    ]);
  });

  it("sets a value only where it differs", () => {
    expect(setEdits(files, "C", "Acme").map((e) => e.file_id)).toEqual(["b", "c"]);
    expect(setEdits(files, "C", null)).toEqual([{ file_id: "a", key: "C", value: null }]);
  });

  it("adds and removes Multi-select values, keeping each file's others", () => {
    expect(listEdits(files, "P", ["z"], ["x"], true)).toEqual([
      { file_id: "a", key: "P", value: ["z"] },
      { file_id: "b", key: "P", value: ["y", "z"] },
      { file_id: "c", key: "P", value: ["z"] },
    ]);
  });

  it("clears a Multi-select emptied of its values", () => {
    expect(listEdits([files[0]], "P", [], ["x"], true)).toEqual([{ file_id: "a", key: "P", value: null }]);
  });

  it("replaces a Select's value with the one picked", () => {
    expect(listEdits(files, "C", ["Globex"], [], false).map((e) => e.value)).toEqual(["Globex", "Globex", "Globex"]);
    expect(listEdits(files, "C", [], ["Acme"], false)).toEqual([{ file_id: "a", key: "C", value: null }]);
  });

  it("remembers the cells as they were, for Undo", () => {
    const edits = setEdits(files, "C", "Globex");
    expect(editsBefore(edits, files).map((e) => e.value)).toEqual(["Acme", null, null]);
  });
});

describe("Information", () => {
  it("gives one text, or Mixed", () => {
    expect(sameText(["a", "a"])).toBe("a");
    expect(sameText(["a", "b"])).toBe("Mixed");
    expect(sameText([])).toBe("");
  });

  it("lists the media properties any file holds, shared or Mixed", () => {
    const a = file("a", { camera_make: "Canon", iso: 100 });
    const b = file("b", { camera_make: "Canon" });
    const rows = mediaRows([a, b]);
    expect(rows.find((r) => r.label === "Camera Make")?.text).toBe("Canon");
    expect(rows.find((r) => r.label === "ISO")?.text).toBe("Mixed");
    expect(mediaRows([file("c", { project: "Acme" })])).toEqual([]);
  });

  it("starts with Created and Modified, then the media properties", () => {
    const a = { ...file("a", { camera_make: "Canon" }), timestamp: "2026-05-18T10:06:00Z", modified_at: null };
    const rows = informationRows([a]);
    expect(rows.map((r) => r.label)).toEqual(["Created", "Modified", "Camera Make"]);
    expect(rows[0].text).toBe(rows[1].text);
    expect(informationRows([])).toEqual([]);
  });

  it("dates differing across files are Mixed", () => {
    const a = { ...file("a", {}), timestamp: "2026-05-18T10:06:00Z" };
    const b = { ...file("b", {}), timestamp: "2025-01-02T10:06:00Z" };
    expect(informationRows([a, b])[0].text).toBe("Mixed");
  });

  it("cuts long Information short until Show More", () => {
    const rows = [1, 2, 3, 4, 5, 6];
    expect(showMore(rows, false)).toEqual({ shown: [1, 2, 3, 4], toggle: true });
    expect(showMore(rows, true)).toEqual({ shown: rows, toggle: true });
    expect(showMore([1, 2], false)).toEqual({ shown: [1, 2], toggle: false });
  });
});
