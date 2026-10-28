import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PathBar from "./PathBar";
import { showContextMenu } from "../../lib/nativeMenu";

vi.mock("../../lib/nativeMenu", () => ({ showContextMenu: vi.fn() }));

describe("PathBar", () => {
  it("shows each segment in order", () => {
    render(<PathBar segments={["Scans", "Josh", "2024"].map((label) => ({ label, icon: null }))} />);
    expect(screen.getAllByTitle(/.+/).map((el) => el.title)).toEqual(["Scans", "Josh", "2024"]);
  });

  it("a click on a segment goes there", async () => {
    const onOpen = vi.fn();
    render(<PathBar segments={[{ label: "Scans", icon: null, onOpen }, { label: "Josh", icon: null }]} />);
    await userEvent.click(screen.getByText("Scans"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a right-click shows its neighbours, under the current one, without going anywhere", async () => {
    const entries = [{ type: "check" as const, text: "Josh", checked: true, key: "Josh", action: vi.fn() }];
    const onOpen = vi.fn();
    render(<PathBar segments={[{ label: "Josh", icon: null, menu: () => entries, menuKey: "Josh", onOpen }]} />);
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("Josh") });
    expect(showContextMenu).toHaveBeenCalledWith(entries, expect.objectContaining({ alignKey: "Josh" }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
