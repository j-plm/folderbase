import { describe, expect, it } from "vitest";
import { lastBackupText, restoreQuestion, scheduleNote } from "./backup";
import type { BackupInfo } from "./commands";

const now = new Date("2026-11-23T14:00:00Z");
const before = (ms: number) => new Date(now.getTime() - ms).toISOString();
const HOUR = 3_600_000;

describe("lastBackupText", () => {
  it("says never when there's been none", () => {
    expect(lastBackupText(null, now)).toBe("Never");
    expect(lastBackupText("not a date", now)).toBe("Never");
  });

  it("counts up from minutes to months", () => {
    expect(lastBackupText(before(20_000), now)).toBe("Just now");
    expect(lastBackupText(before(60_000), now)).toBe("1 minute ago");
    expect(lastBackupText(before(5 * 60_000), now)).toBe("5 minutes ago");
    expect(lastBackupText(before(3 * HOUR), now)).toBe("3 hours ago");
    expect(lastBackupText(before(30 * HOUR), now)).toBe("Yesterday");
    expect(lastBackupText(before(50 * HOUR), now)).toBe("2 days ago");
    expect(lastBackupText(before(8 * 24 * HOUR), now)).toBe("1 week ago");
    expect(lastBackupText(before(90 * 24 * HOUR), now)).toBe("3 months ago");
  });
});

describe("scheduleNote", () => {
  it("says how many are kept, and that the app data folder stays on this Mac", () => {
    expect(scheduleNote("daily", "/Users/sam/pCloud")).toContain("the last 7");
    expect(scheduleNote("weekly", "/Users/sam/pCloud")).toContain("the last 4");
    expect(scheduleNote("daily", null)).toContain("stay on this Mac");
    expect(scheduleNote("daily", "/x")).not.toContain("stay on this Mac");
    expect(scheduleNote("never", null)).toContain("Back Up Database…");
  });
});

describe("restoreQuestion", () => {
  const info = (missing: BackupInfo["missing"]): BackupInfo => ({
    manifest: { format_version: 1, app_version: "0.1.0", created_at: "2026-11-01T09:00:00Z", machine: "Sam’s MacBook", locations: missing },
    missing,
  });

  it("says when and where it was made, and what's replaced", () => {
    const { title, message } = restoreQuestion(info([]), "1 November");
    expect(title).toBe("Restore from this backup?");
    expect(message).toContain("made on 1 November on “Sam’s MacBook”");
    expect(message).toContain("values, views and settings will be replaced");
    expect(message).not.toContain("Locate Folder");
  });

  it("names the folders that aren't here and points to Locate Folder…", () => {
    const one = restoreQuestion(info([{ name: "Photos", root_path: "/Volumes/Photos" }]), "x").message;
    expect(one).toContain("This location’s folder isn’t on this Mac: “Photos” (/Volumes/Photos)");
    expect(one).toContain("Locate Folder…");
    const two = restoreQuestion(
      info([
        { name: "Photos", root_path: "/a" },
        { name: "Work", root_path: "/b" },
      ]),
      "x"
    ).message;
    expect(two).toContain("These locations’ folders aren’t");
    expect(two).toContain("where they are");
  });
});
