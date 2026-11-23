import type { BackupInfo, BackupSchedule } from "./commands";

// How backups read in Settings ▸ Advanced and in Restore from Backup…'s
// question. Pure, so it's tested (backup.test.ts).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/** "Last backup: 2 days ago", from when it was made; "Never" when there's been none. */
export function lastBackupText(lastBackup: string | null, now: Date = new Date()): string {
  if (!lastBackup) return "Never";
  const when = new Date(lastBackup);
  if (Number.isNaN(when.getTime())) return "Never";
  const elapsed = now.getTime() - when.getTime();
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return ago(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return ago(Math.floor(elapsed / HOUR), "hour");
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "Yesterday";
  if (days < 7) return ago(days, "day");
  if (days < 60) return ago(Math.floor(days / 7), "week");
  return ago(Math.floor(days / 30), "month");
}

/** The note under Back up automatically: how many are kept, and where. */
export function scheduleNote(schedule: BackupSchedule, folder: string | null): string {
  if (schedule === "never") return "Back up by hand with Back Up Database…, or from the File menu.";
  const kept = schedule === "daily" ? "the last 7" : "the last 4";
  const where = folder
    ? "Folderbase keeps"
    : "Until you choose a folder, backups stay on this Mac, in Folderbase’s own folder. Choose a synced folder, such as OneDrive or pCloud, to keep a copy off this Mac. Folderbase keeps";
  return `${where} ${kept} automatic backups there; others you make are left alone.`;
}

/**
 * Restore from Backup…'s question: when and where the backup was made, what's
 * replaced, and which folders it expects that aren't here. `when` is the
 * backup's date as it should read ("Monday, 23 November 2026 at 14:05").
 */
export function restoreQuestion(info: BackupInfo, when: string): { title: string; message: string } {
  const { manifest, missing } = info;
  const parts = [
    `This backup was made on ${when} on “${manifest.machine}”.`,
    "Your current values, views and settings will be replaced by the ones in the backup. Your files aren’t touched. A backup of how things are now is made first, and Folderbase restarts to finish.",
  ];
  if (missing.length > 0) {
    const names = missing.map((l) => `“${l.name}” (${l.root_path})`).join(", ");
    const these = missing.length === 1 ? "This location’s folder isn’t" : "These locations’ folders aren’t";
    parts.push(`${these} on this Mac: ${names}. After restoring, use Locate Folder… in Settings ▸ Locations to show Folderbase where ${missing.length === 1 ? "it is" : "they are"}.`);
  }
  return { title: "Restore from this backup?", message: parts.join("\n\n") };
}

/** A backup's date as Restore from Backup… says it. */
export function backupDate(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
}
