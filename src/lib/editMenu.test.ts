import { afterEach, describe, expect, it, vi } from "vitest";
import { isTextField, performEdit, setUndoTarget } from "./editMenu";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isTextField", () => {
  it("counts text inputs, textareas and editable content", () => {
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const checkbox = Object.assign(document.createElement("input"), { type: "checkbox" });
    expect(isTextField(input)).toBe(true);
    expect(isTextField(area)).toBe(true);
    expect(isTextField(checkbox)).toBe(false);
    expect(isTextField(document.createElement("div"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });

  it("ignores focus sinks", () => {
    const sink = document.createElement("textarea");
    sink.dataset.editSink = "";
    expect(isTextField(sink)).toBe(false);
  });
});

describe("performEdit", () => {
  it("goes to the registered history when no text field has focus", () => {
    const target = { undo: vi.fn(), redo: vi.fn() };
    const release = setUndoTarget(target);
    performEdit("undo");
    performEdit("redo");
    expect(target.undo).toHaveBeenCalledOnce();
    expect(target.redo).toHaveBeenCalledOnce();
    release();
    performEdit("undo");
    expect(target.undo).toHaveBeenCalledOnce();
  });

  it("leaves the history alone while typing in a field", () => {
    const target = { undo: vi.fn(), redo: vi.fn() };
    const release = setUndoTarget(target);
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    document.execCommand = vi.fn();
    performEdit("undo");
    expect(document.execCommand).toHaveBeenCalledWith("undo");
    expect(target.undo).not.toHaveBeenCalled();
    release();
  });

  it("a stale release doesn't remove a newer target", () => {
    const first = { undo: vi.fn(), redo: vi.fn() };
    const second = { undo: vi.fn(), redo: vi.fn() };
    const releaseFirst = setUndoTarget(first);
    const releaseSecond = setUndoTarget(second);
    releaseFirst();
    performEdit("undo");
    expect(second.undo).toHaveBeenCalledOnce();
    releaseSecond();
  });
});
