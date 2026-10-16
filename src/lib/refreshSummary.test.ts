import { describe, expect, it } from "vitest";
import { describeRefresh } from "./refreshSummary";

describe("describeRefresh", () => {
  it("lists only what changed", () => {
    expect(describeRefresh({ added: 3, updated: 0, moved: 1, removed: 2 })).toBe("3 added, 1 moved, 2 removed");
    expect(describeRefresh({ added: 0, updated: 0, moved: 0, removed: 0 })).toBe("Up to date");
  });
});
