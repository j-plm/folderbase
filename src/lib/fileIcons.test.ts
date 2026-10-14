import { describe, expect, it } from "vitest";
import { fileExtension } from "./fileIcons";

describe("fileExtension", () => {
  it("returns the lowercase extension", () => {
    expect(fileExtension("/Users/me/Scans/Receipt.PDF")).toBe("pdf");
    expect(fileExtension("C:\\Docs\\photo.final.jpeg")).toBe("jpeg");
  });

  it("returns empty for no extension or dotfiles", () => {
    expect(fileExtension("/tmp/Makefile")).toBe("");
    expect(fileExtension("/tmp/.hidden")).toBe("");
    expect(fileExtension("")).toBe("");
  });
});
