import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/menu", () => ({}));
vi.mock("@tauri-apps/api/dpi", () => ({}));

const { menuItemCenter } = await import("./nativeMenu");
import type { MenuEntry } from "./nativeMenu";

const macos = { item: 24, separator: 11, padding: 5 };
const check = (text: string): MenuEntry => ({ type: "check", text, checked: true, action: () => {} });

describe("menuItemCenter", () => {
  it("centres the first item below the top padding", () => {
    expect(menuItemCenter([check("Name")], 0, macos)).toBe(17);
  });

  it("counts items and separators above the target", () => {
    const entries = [check("Name"), check("Path"), { type: "separator" } as const, check("Tags")];
    expect(menuItemCenter(entries, 3, macos)).toBe(5 + 24 + 24 + 11 + 12);
  });
});
