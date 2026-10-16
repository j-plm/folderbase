import { describe, expect, it } from "vitest";
import {
  columnAtOffset,
  columnOffset,
  countFoldersNamed,
  coveredValues,
} from "./tagDrag";

describe("countFoldersNamed", () => {
  it("counts same-named folders at any depth once each", () => {
    const paths = ["Clients/Acme/a.pdf", "Clients/Acme/b.pdf", "Archive/2023/Acme/c.pdf", "Acme.pdf", null];
    expect(countFoldersNamed(paths, "Acme")).toBe(2);
  });

  it("ignores file names and partial matches", () => {
    expect(countFoldersNamed(["Acme Ltd/x.pdf", "Docs/Acme"], "Acme")).toBe(0);
  });
});

describe("coveredValues", () => {
  it("collects list and single values, skipping internal keys", () => {
    const covered = coveredValues({ Client: ["Acme", "Beta"], Status: "Done", _hidden: "Secret", Count: 3 });
    expect([...covered].sort()).toEqual(["3", "Acme", "Beta", "Done"]);
  });

  it("is empty for no metadata", () => {
    expect(coveredValues(null).size).toBe(0);
  });
});

describe("column hit-testing", () => {
  const cols = [
    { id: "name", width: 100 },
    { id: "prop:Client", width: 80 },
    { id: "__add", width: 32 },
  ];

  it("finds the column under an offset", () => {
    expect(columnAtOffset(0, cols)).toBe("name");
    expect(columnAtOffset(99, cols)).toBe("name");
    expect(columnAtOffset(100, cols)).toBe("prop:Client");
    expect(columnAtOffset(200, cols)).toBe("__add");
  });

  it("returns null outside the columns", () => {
    expect(columnAtOffset(-1, cols)).toBeNull();
    expect(columnAtOffset(212, cols)).toBeNull();
  });

  it("gives a column's starting offset", () => {
    expect(columnOffset("prop:Client", cols)).toBe(100);
    expect(columnOffset("__add", cols)).toBe(180);
  });
});
