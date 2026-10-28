import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useBrowseKeys } from "./useBrowseKeys";

function Shell({ onViewKey, dialog = false }: { onViewKey: (key: string) => void; dialog?: boolean }) {
  useBrowseKeys();
  return (
    <>
      <div data-keys-to-browse>
        <button>Tiles</button>
        <input aria-label="Search" />
      </div>
      <div data-browse-keys tabIndex={0} aria-label="View" onKeyDown={(e) => onViewKey(e.key)} />
      {dialog && <div role="dialog" />}
    </>
  );
}

describe("useBrowseKeys", () => {
  it("sends an arrow pressed with nothing focused to the view, which takes focus", () => {
    const onViewKey = vi.fn();
    render(<Shell onViewKey={onViewKey} />);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(onViewKey).toHaveBeenCalledWith("ArrowDown");
    expect(document.activeElement).toBe(screen.getByLabelText("View"));
  });

  it("sends arrows from the toolbar or sidebar, but not from a text field", () => {
    const onViewKey = vi.fn();
    render(<Shell onViewKey={onViewKey} />);
    screen.getByText("Tiles").focus();
    fireEvent.keyDown(screen.getByText("Tiles"), { key: "ArrowRight" });
    expect(onViewKey).toHaveBeenCalledTimes(1);
    screen.getByLabelText("Search").focus();
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "ArrowLeft" });
    expect(onViewKey).toHaveBeenCalledTimes(1);
  });

  it("leaves keys alone while a dialog or popover is open, and ⌘↑ to Enclosing Folder", () => {
    const onViewKey = vi.fn();
    const { rerender } = render(<Shell onViewKey={onViewKey} dialog />);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    rerender(<Shell onViewKey={onViewKey} />);
    fireEvent.keyDown(document.body, { key: "ArrowUp", metaKey: true });
    expect(onViewKey).not.toHaveBeenCalled();
  });
});
