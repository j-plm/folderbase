import { describe, expect, it } from "vitest";
import { visibleItemCount } from "./overflow";

describe("visibleItemCount", () => {
  it("shows everything when it all fits", () => {
    expect(visibleItemCount([100, 80, 60], 10, 260, 30)).toBe(3);
  });

  it("reserves room for the overflow button and drops trailing items", () => {
    // 30 (button) + 10 + 100 + 10 + 80 = 230 fits; + 10 + 60 = 300 does not
    expect(visibleItemCount([100, 80, 60], 10, 259, 30)).toBe(2);
  });

  it("can overflow everything", () => {
    expect(visibleItemCount([100, 80], 10, 50, 30)).toBe(0);
    expect(visibleItemCount([], 10, 0, 30)).toBe(0);
  });
});
