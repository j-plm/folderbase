import { describe, expect, it } from "vitest";
import { previewTargets } from "./quickLook";

const paths: Record<string, string> = { a: "/l/a.jpg", b: "/l/b.pdf", c: "/l/c.txt" };
const pathOf = (id: string) => paths[id];

describe("previewTargets", () => {
  it("previews the selected files in display order", () => {
    expect(previewTargets(["a", "b", "c"], pathOf)).toEqual({ paths: ["/l/a.jpg", "/l/b.pdf", "/l/c.txt"], index: 0 });
  });

  it("starts on the item last clicked or moved to", () => {
    expect(previewTargets(["a", "b", "c"], pathOf, "c").index).toBe(2);
  });

  it("leaves out virtual folders, which have nothing on disk", () => {
    expect(previewTargets(["folder:Acme", "b", "c"], pathOf, "c")).toEqual({ paths: ["/l/b.pdf", "/l/c.txt"], index: 1 });
  });

  it("starts at the first file when the focus is a folder or not selected", () => {
    expect(previewTargets(["folder:Acme", "b"], pathOf, "folder:Acme").index).toBe(0);
    expect(previewTargets(["a", "b"], pathOf, "z").index).toBe(0);
  });

  it("gives nothing for a selection of folders only", () => {
    expect(previewTargets(["folder:Acme"], pathOf, "folder:Acme")).toEqual({ paths: [], index: 0 });
  });
});
