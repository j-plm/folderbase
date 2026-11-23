import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, folderName, zipFolder } from "./appSettings";

const state = (zip_folder: string | null, downloads: string | null) => ({ settings: { ...DEFAULT_SETTINGS, zip_folder }, downloads });

describe("zipFolder", () => {
  it("is Downloads until a folder is chosen", () => {
    expect(zipFolder(state(null, "/Users/me/Downloads"))).toBe("/Users/me/Downloads");
    expect(zipFolder(state("/Users/me/Shared", "/Users/me/Downloads"))).toBe("/Users/me/Shared");
  });
});

describe("folderName", () => {
  it("shows a folder by its own name, and Downloads before it's known", () => {
    expect(folderName("/Users/me/Shared/")).toBe("Shared");
    expect(folderName("C:\\Users\\me\\Zips")).toBe("Zips");
    expect(folderName(null)).toBe("Downloads");
  });
});
