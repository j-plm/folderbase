import { describe, expect, it, vi } from "vitest";
import { locationOf, openWithEntries } from "./fileActions";
import type { Location, OpenWithApp } from "./commands";

const loc = (location_id: string, root_path: string): Location => ({
  location_id,
  name: location_id,
  root_path,
  library: location_id,
  added_at: "",
  last_indexed: null,
  added_folder: null,
});

describe("locationOf", () => {
  const locations = [loc("docs", "/Cloud/Docs"), loc("testing", "/Cloud/Docs/05 Testing"), loc("docs2", "/Cloud/Docs 2")];

  it("finds the most specific location holding the file", () => {
    expect(locationOf("/Cloud/Docs/05 Testing/a.tif", locations)?.location_id).toBe("testing");
    expect(locationOf("/Cloud/Docs/b.pdf", locations)?.location_id).toBe("docs");
  });

  it("doesn't take a folder whose name only starts the same", () => {
    expect(locationOf("/Cloud/Docs 2/c.dxf", locations)?.location_id).toBe("docs2");
    expect(locationOf("/Elsewhere/d.txt", locations)).toBeNull();
  });
});

describe("openWithEntries", () => {
  const app = (name: string, is_default = false): OpenWithApp => ({ path: `/Applications/${name}.app`, name, is_default });
  const texts = (entries: ReturnType<typeof openWithEntries>) =>
    entries.map((e) => (e.type === "separator" ? "—" : "text" in e ? e.text : ""));

  it("marks the default and sets it apart, Other… last", () => {
    const entries = openWithEntries([app("QCAD", true), app("Inkscape")], () => {}, () => {});
    expect(texts(entries)).toEqual(["QCAD (default)", "—", "Inkscape", "—", "Other…"]);
  });

  it("offers only Other… when no app can open the files", () => {
    expect(texts(openWithEntries([], () => {}, () => {}))).toEqual(["Other…"]);
  });

  it("opens in the app chosen", () => {
    const open = vi.fn();
    const [first] = openWithEntries([app("Preview", true)], open, () => {});
    if (first.type === "item") first.action();
    expect(open).toHaveBeenCalledWith("/Applications/Preview.app");
  });
});
