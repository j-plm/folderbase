import { describe, expect, it } from "vitest";
import { activityLine, type Activity, type SyncProgress } from "./activity";

const refresh = (progress: SyncProgress): Activity => ({ kind: "refresh", progress });

describe("activityLine", () => {
  it("counts files found while listing, with no total yet", () => {
    const line = activityLine(refresh({ phase: "listing", found: 1240 }), "Documents");
    expect(line.title).toBe("Looking for files in “Documents”…");
    expect(line.detail).toBe("1,240 files found");
    expect(line.fraction).toBeNull();
    expect(line.stoppable).toBe(true);
  });

  it("fills the bar while reading", () => {
    const line = activityLine(refresh({ phase: "reading", done: 320, total: 800 }), "Documents");
    expect(line.detail).toBe("320 of 800 files");
    expect(line.fraction).toBe(0.4);
  });

  it("can't be stopped once it's saving", () => {
    expect(activityLine(refresh({ phase: "saving" }), "Documents").stoppable).toBe(false);
  });

  it("says what a finished refresh changed, or that it stopped or failed", () => {
    const summary = { added: 3, updated: 0, moved: 1, removed: 0 };
    expect(activityLine({ kind: "refresh", progress: null, finished: { summary, error: null, stopped: false } }, "Documents")).toMatchObject({
      title: "Refreshed “Documents”",
      detail: "3 added, 1 moved",
      tone: "done",
    });
    expect(activityLine({ kind: "refresh", progress: null, finished: { summary: null, error: null, stopped: true } }, "Documents")).toMatchObject({
      title: "Refresh stopped",
      detail: "Nothing was changed",
    });
    expect(
      activityLine({ kind: "refresh", progress: null, finished: { summary: null, error: "Drive missing", stopped: false } }, "Documents")
    ).toMatchObject({ tone: "error", detail: "Drive missing" });
  });

  it("reads a copy as Finder does, by bytes", () => {
    const progress = { files_done: 1, files_total: 3, bytes_done: 45_200_000, bytes_total: 1_200_000_000, name: "Talk.m4a" };
    const line = activityLine({ kind: "copy", progress }, "Documents");
    expect(line.title).toBe("Copying 3 items to “Documents”");
    expect(line.detail).toBe("45.2 MB of 1.2 GB — Talk.m4a");
    expect(line.fraction).toBeCloseTo(0.0377, 3);
  });

  it("says the copies are being added once they're all copied", () => {
    const progress = { files_done: 1, files_total: 1, bytes_done: 10, bytes_total: 10, name: "a.txt" };
    expect(activityLine({ kind: "copy", progress }, "Documents")).toMatchObject({ title: "Adding 1 item to “Documents”…", fraction: null });
  });
});
