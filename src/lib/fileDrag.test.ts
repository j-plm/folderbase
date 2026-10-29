import { describe, expect, it } from "vitest";
import { dragItemsFor } from "./fileDrag";
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
