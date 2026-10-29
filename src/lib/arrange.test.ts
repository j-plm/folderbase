import { describe, expect, it } from "vitest";
import type { FileRecord } from "../types";
import {
  dateGroup,
  dateGroupRange,
  formatFinderDate,
  formatFinderSize,
  formatLongDate,
  groupFiles,
  kindCategory,
  kindLabel,
  sizeGroup,
  sizeGroupRange,
  sortFiles,
  type Arrangement,
} from "./arrange";

function file(path: string, extra: Partial<FileRecord> = {}): FileRecord {
  return {
    file_id: path,
    file_path: path,
    file_type: null,
    timestamp: null,
    library: null,
    metadata: null,
    tags: [],
    ...extra,
  };
}

const byName: Arrangement["sort"] = { key: "name", direction: "asc" };

describe("kindCategory", () => {
  it("maps files to Finder's kind groups", () => {
    expect(kindCategory(file("/a/r.pdf", { file_type: "application/pdf" }))).toBe("PDF Documents");
    expect(kindCategory(file("/a/p.jpg", { file_type: "image/jpeg" }))).toBe("Images");
    expect(kindCategory(file("/a/m.mov", { file_type: "video/quicktime" }))).toBe("Movies");
    expect(kindCategory(file("/a/s.mp3", { file_type: "audio/mpeg" }))).toBe("Music");
    expect(kindCategory(file("/a/deck.pptx"))).toBe("Presentations");
    expect(kindCategory(file("/a/data.csv", { file_type: "text/csv" }))).toBe("Spreadsheets");
    expect(kindCategory(file("/a/main.rs", { file_type: "text/x-rust" }))).toBe("Developer");
    expect(kindCategory(file("/a/notes.docx"))).toBe("Documents");
    expect(kindCategory(file("/a/readme.txt", { file_type: "text/plain" }))).toBe("Documents");
    expect(kindCategory(file("/a/archive.zip", { file_type: "application/zip" }))).toBe("Other");
  });
});

describe("sortFiles", () => {
  it("sorts naturally and breaks ties by name", () => {
    const files = [file("/x/file10.txt"), file("/x/file2.txt"), file("/x/File1.txt")];
    expect(sortFiles(files, byName).map((f) => f.file_path)).toEqual([
      "/x/File1.txt",
      "/x/file2.txt",
      "/x/file10.txt",
    ]);
    const sized = [file("/b", { file_size: 5 }), file("/a", { file_size: 5 }), file("/c", { file_size: 9 })];
    expect(sortFiles(sized, { key: "size", direction: "desc" }).map((f) => f.file_path)).toEqual(["/c", "/a", "/b"]);
  });
});

describe("groupFiles", () => {
  const byProperty = {
    keyOf: (f: FileRecord, column: string) => {
      const v = (f.metadata as Record<string, unknown> | null)?.[column.slice(5)];
      return typeof v === "string" ? { label: v, rank: v } : null;
    },
    emptyLabel: (column: string) => `No ${column.slice(5)}`,
  };

  it("groups by a property's value, in the value's order, files without one last", () => {
    const groups = groupFiles(
      [file("/a", { metadata: { Client: "Globex" } }), file("/b", { metadata: {} }), file("/c", { metadata: { Client: "Acme" } })],
      { sort: byName, groupBy: "prop:Client" },
      new Date(),
      byProperty
    );
    expect(groups.map((g) => [g.label, g.value, g.files.map((f) => f.file_path)])).toEqual([
      ["Acme", "Acme", ["/c"]],
      ["Globex", "Globex", ["/a"]],
      ["No Client", "", ["/b"]],
    ]);
  });

  it("doesn't group by a property it can't read", () => {
    const groups = groupFiles([file("/a"), file("/b")], { sort: byName, groupBy: "prop:Client" });
    expect(groups).toEqual([{ label: "", files: [expect.anything(), expect.anything()] }]);
  });

  it("returns one unlabelled group when not grouping", () => {
    const groups = groupFiles([file("/b"), file("/a")], { sort: byName, groupBy: "none" });
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("");
    expect(groups[0].files.map((f) => f.file_path)).toEqual(["/a", "/b"]);
  });

  it("orders kind groups the Finder way, sorted within each group", () => {
    const groups = groupFiles(
      [
        file("/z.pdf", { file_type: "application/pdf" }),
        file("/b.docx"),
        file("/a.docx"),
        file("/x.zip"),
      ],
      { sort: byName, groupBy: "kind" }
    );
    expect(groups.map((g) => g.label)).toEqual(["Documents", "PDF Documents", "Other"]);
    expect(groups[0].files.map((f) => f.file_path)).toEqual(["/a.docx", "/b.docx"]);
  });

  it("buckets dates relative to now, newest first", () => {
    const now = new Date(2026, 9, 14, 12);
    const groups = groupFiles(
      [
        file("/old", { modified_at: new Date(2024, 2, 1).toISOString() }),
        file("/today", { modified_at: new Date(2026, 9, 14, 9).toISOString() }),
        file("/yesterday", { modified_at: new Date(2026, 9, 13, 9).toISOString() }),
        file("/march", { modified_at: new Date(2026, 2, 3).toISOString() }),
        file("/none"),
      ],
      { sort: byName, groupBy: "modified" },
      now
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "March", "2024", "No Date"]);
  });

  it("buckets sizes largest first", () => {
    const groups = groupFiles(
      [file("/s", { file_size: 500 }), file("/l", { file_size: 5 * 1024 * 1024 })],
      { sort: byName, groupBy: "size" }
    );
    expect(groups.map((g) => g.label)).toEqual(["1 MB to 10 MB", "Less than 10 KB"]);
  });

  it("groups names by first letter, digits first", () => {
    const groups = groupFiles([file("/beta"), file("/2024 notes"), file("/alpha")], { sort: byName, groupBy: "name" });
    expect(groups.map((g) => g.label)).toEqual(["0–9", "A", "B"]);
  });
});

describe("Finder formatting", () => {
  it("formats sizes in decimal units like Finder", () => {
    expect(formatFinderSize(512)).toBe("512 bytes");
    expect(formatFinderSize(5_200)).toBe("5 KB");
    expect(formatFinderSize(1_700_000)).toBe("1.7 MB");
    expect(formatFinderSize(33_500_000)).toBe("33.5 MB");
    expect(formatFinderSize(null)).toBe("--");
  });

  it("uses Today / Yesterday for recent dates", () => {
    const now = new Date(2026, 9, 14, 12);
    expect(formatFinderDate(new Date(2026, 9, 14, 5, 58).toISOString(), now)).toMatch(/^Today at /);
    expect(formatFinderDate(new Date(2026, 9, 13, 22, 6).toISOString(), now)).toMatch(/^Yesterday at /);
    expect(formatFinderDate(new Date(2026, 7, 13, 13, 7).toISOString(), now)).toMatch(/2026 at /);
    expect(formatFinderDate(null, now)).toBe("--");
  });

  it("formats long dates with weekday and time", () => {
    const out = formatLongDate(new Date(2026, 4, 18, 10, 6).toISOString());
    expect(out).toMatch(/Monday/);
    expect(out).toMatch(/2026 at /);
    expect(formatLongDate(null)).toBe("--");
  });

  it("names kinds the way Finder does", () => {
    expect(kindLabel(file("/a/x.xlsx"))).toBe("Microsoft Excel workbook (.xlsx)");
    expect(kindLabel(file("/a/x.png", { file_type: "image/png" }))).toBe("PNG image");
    expect(kindLabel(file("/a/x.webp", { file_type: "image/webp" }))).toBe("WEBP image");
    expect(kindLabel(file("/a/x.drawio"))).toBe("DRAWIO file");
  });
});

describe("bucket ranges", () => {
  it("covers exactly the days each date bucket holds", () => {
    for (const now of [new Date(2026, 9, 27, 15), new Date(2026, 0, 12, 9)]) {
      for (let back = 0; back < 800; back++) {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 12);
        const [label] = dateGroup(day.toISOString(), now);
        const range = dateGroupRange(label, now);
        expect(range, label).not.toBeNull();
        const [from, end] = range!;
        expect(day >= from && (end == null || day < end), `${label} ${day.toDateString()}`).toBe(true);
      }
    }
    expect(dateGroupRange("No Date", new Date())).toBeNull();
  });

  it("covers exactly the sizes each size bucket holds", () => {
    for (const bytes of [0, 10239, 10240, 99999, 1048575, 1048576, 2 ** 30 - 1, 2 ** 30, 2 ** 40]) {
      const [min, end] = sizeGroupRange(sizeGroup(bytes)[0])!;
      expect(bytes >= min && (end == null || bytes < end)).toBe(true);
    }
    expect(sizeGroupRange("Huge")).toBeNull();
  });
});
