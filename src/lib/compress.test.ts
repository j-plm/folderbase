import { describe, expect, it } from "vitest";
import { archivePlan, hasFiles, itemsName, safeName } from "./compress";
import type { DragItem } from "./filing";
import { folderTree } from "./folderTree";
import { impliedByFile, valueReader } from "./fileValues";
import type { FolderLevel } from "./tableViews";
import type { FileRecord, ValueType } from "../types";

const file = (id: string, metadata: Record<string, unknown>, path = `${id}.pdf`): FileRecord => ({
  file_id: id,
  file_path: `/root/${path}`,
  relative_path: path,
  file_type: "pdf",
  timestamp: null,
  library: "docs",
  metadata,
  tags: path.split("/").slice(0, -1),
});

const TYPES: Record<string, ValueType> = { Client: "enum", Project: "array", Year: "number" };
const typeOf = (name: string): ValueType => TYPES[name] ?? "free_text";
const label = (column: string) => column.replace(/^prop:/, "");
const level = (column: string, next: FolderLevel | null = null): FolderLevel => ({ column, direction: "asc", next, branches: {} });

function treeFor(files: FileRecord[], root: FolderLevel | null) {
  const reader = valueReader({ typeOf, scopes: [], implied: impliedByFile(files, [], (p) => typeOf(p) === "array") });
  return folderTree(files, root, reader, typeOf, label, { pins: [{ column: "prop:Client", value: "Initech", at: [] }] });
}

const files = [
  file("1", { Client: "Acme", Year: 2024 }, "scans/2019/invoice.pdf"),
  file("2", { Client: "Acme", Year: 2023 }, "mail/invoice.pdf"),
  file("3", { Client: "Globex", Year: 2024 }, "globex/report.pdf"),
  file("4", {}, "loose/notes.txt"),
];
const tree = treeFor(files, level("prop:Client", level("prop:Year")));
const asFile = (f: FileRecord, from: string[] | null = []): DragItem => ({ kind: "file", file: f, from });
const pairs = (plan: { entries: { archive_path: string; disk_path: string }[] }) =>
  plan.entries.map((e) => [e.archive_path, e.disk_path]);

describe("archivePlan", () => {
  it("zips a folder as the folders shown below it, not where the files are on disk", () => {
    const plan = archivePlan([{ kind: "folder", path: ["Acme"] }], tree, null);
    expect(plan.name).toBe("Acme.zip");
    expect(pairs(plan)).toEqual([
      ["Acme/2023/invoice.pdf", "/root/mail/invoice.pdf"],
      ["Acme/2024/invoice.pdf", "/root/scans/2019/invoice.pdf"],
    ]);
  });

  it("zips the top as every folder, with the No value folder named as it shows and empty folders left out", () => {
    const plan = archivePlan([{ kind: "folder", path: [] }], tree, "Clients");
    expect(plan.name).toBe("Clients.zip");
    expect(plan.entries.map((e) => e.archive_path)).toEqual([
      "Clients/Acme/2023/invoice.pdf",
      "Clients/Acme/2024/invoice.pdf",
      "Clients/Globex/2024/report.pdf",
      "Clients/No Client/No Year/notes.txt",
    ]);
  });

  it("puts picked files at the top and picked folders beside them", () => {
    const plan = archivePlan([asFile(files[3], []), { kind: "folder", path: ["Globex"] }], tree, null);
    expect(plan.name).toBe("Archive.zip");
    expect(plan.entries.map((e) => e.archive_path)).toEqual(["notes.txt", "Globex/2024/report.pdf"]);
  });

  it("numbers files with the same name, as Finder's Keep Both does", () => {
    const plan = archivePlan([asFile(files[0]), asFile(files[1])], null, "Acme");
    expect(plan.name).toBe("Acme.zip");
    expect(plan.entries.map((e) => e.archive_path)).toEqual(["invoice.pdf", "invoice 2.pdf"]);
  });

  it("numbers a file whose name differs only in case", () => {
    const upper = file("5", {}, "x/INVOICE.pdf");
    expect(archivePlan([asFile(files[0]), asFile(upper)], null, null).entries.map((e) => e.archive_path)).toEqual([
      "invoice.pdf",
      "INVOICE 2.pdf",
    ]);
  });

  it("names a zip of one file after the file", () => {
    expect(archivePlan([asFile(files[2])], null, "Globex").name).toBe("report.pdf.zip");
  });

  it("puts a file picked twice in once", () => {
    expect(archivePlan([asFile(files[0], ["Acme"]), asFile(files[0], ["2024"])], null, null).entries).toHaveLength(1);
  });

  it("puts a Multi-select file in every folder it shows in", () => {
    const multi = [file("1", { Project: ["Apollo", "Hermes"] }, "a.pdf")];
    const plan = archivePlan([{ kind: "folder", path: [] }], treeFor(multi, level("prop:Project")), "Work");
    expect(plan.entries.map((e) => e.archive_path)).toEqual(["Work/Apollo/a.pdf", "Work/Hermes/a.pdf"]);
  });

  it("ignores folders when there's no tree (the Database view)", () => {
    expect(archivePlan([{ kind: "folder", path: ["Acme"] }], null, null).entries).toEqual([]);
  });
});

describe("safeName", () => {
  it("keeps slashes and colons out of names", () => {
    expect(safeName("AC/DC: Live")).toBe("AC-DC- Live");
  });
  it("never gives an empty name or a dot", () => {
    expect(safeName("  ")).toBe("Untitled");
    expect(safeName("..")).toBe("Untitled");
  });
});

describe("itemsName and hasFiles", () => {
  it("names one item, and counts several", () => {
    expect(itemsName([{ kind: "folder", path: ["Acme"] }], tree)).toEqual({ count: 1, name: "Acme" });
    expect(itemsName([asFile(files[0])], null)).toEqual({ count: 1, name: "invoice.pdf" });
    expect(itemsName([asFile(files[0]), asFile(files[1])], null)).toEqual({ count: 2, name: null });
  });
  it("finds nothing to zip in an empty folder", () => {
    expect(hasFiles([{ kind: "folder", path: ["Initech"] }], tree)).toBe(false);
    expect(hasFiles([{ kind: "folder", path: ["Acme"] }], tree)).toBe(true);
  });
});
