import { describe, expect, it } from "vitest";
import { previewAvailable, previewShown, togglePreview } from "./previewPane";

describe("Preview pane per view mode", () => {
  it("is hidden by default, and never in Columns", () => {
    expect(previewShown("tiles", {})).toBe(false);
    expect(previewShown("database", {})).toBe(false);
    expect(previewShown("columns", { columns: true })).toBe(false);
    expect(previewAvailable("columns")).toBe(false);
  });

  it("is kept per mode", () => {
    const saved = togglePreview("list", {});
    expect(previewShown("list", saved)).toBe(true);
    expect(previewShown("tiles", saved)).toBe(false);
    expect(previewShown("list", togglePreview("list", saved))).toBe(false);
  });

  it("leaves Columns alone", () => {
    const saved = { list: true };
    expect(togglePreview("columns", saved)).toBe(saved);
  });
});
