import { afterEach, describe, expect, it } from "vitest";
import { iconFrames, previewTargets } from "./quickLook";

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

describe("iconFrames", () => {
  /** An icon for `path` at the given place, and what's on top at its middle. */
  function icon(path: string, rect: { x: number; y: number; width: number; height: number }) {
    const el = document.createElement("img");
    el.dataset.iconOf = path;
    el.getBoundingClientRect = () =>
      ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height, right: rect.x + rect.width, bottom: rect.y + rect.height }) as DOMRect;
    document.body.appendChild(el);
    return el;
  }
  const onTop = new Map<string, Element>(); // "x,y" → element there
  document.elementFromPoint = (x: number, y: number) => onTop.get(`${x},${y}`) ?? document.body;
  afterEach(() => {
    document.body.innerHTML = "";
    onTop.clear();
  });

  it("gives where each file's icon is, in the order asked", () => {
    const a = icon("/l/a.jpg", { x: 10, y: 20, width: 16, height: 16 });
    const b = icon("/l/b.pdf", { x: 10, y: 40, width: 16, height: 16 });
    onTop.set("18,28", a);
    onTop.set("18,48", b);
    expect(iconFrames(["/l/b.pdf", "/l/a.jpg"])).toEqual([
      { x: 10, y: 40, width: 16, height: 16 },
      { x: 10, y: 20, width: 16, height: 16 },
    ]);
  });

  it("gives null for a file whose icon is scrolled away or covered, so the panel fades", () => {
    icon("/l/a.jpg", { x: 10, y: 20, width: 16, height: 16 }); // something else on top
    icon("/l/b.pdf", { x: 10, y: -100, width: 16, height: 16 }); // above the window
    expect(iconFrames(["/l/a.jpg", "/l/b.pdf", "/l/c.txt"])).toEqual([null, null, null]);
  });

  it("takes the first icon that can be seen when a file shows twice", () => {
    icon("/l/a.jpg", { x: 0, y: 0, width: 0, height: 0 }); // collapsed
    const big = icon("/l/a.jpg", { x: 600, y: 100, width: 128, height: 128 });
    onTop.set("664,164", big);
    expect(iconFrames(["/l/a.jpg"])).toEqual([{ x: 600, y: 100, width: 128, height: 128 }]);
  });
});
