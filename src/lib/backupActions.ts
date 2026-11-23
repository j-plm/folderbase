import { ask, message } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  BACKUP_STATUS,
  backUpDatabase,
  backupSuggestion,
  inspectBackup,
  pickBackupDestination,
  pickBackupFile,
  pickDirectory,
  restoreFromBackup,
  revealPaths,
  setAppSettings,
  setBackupFolder,
  type BackupStatus,
} from "./commands";
import { backupDate, restoreQuestion } from "./backup";

// Back Up Database… and Restore from Backup… (Settings ▸ Advanced and the File
// menu), and asking where backups go. Run in whichever window asked, so their
// panels open over it. Rust tells every window as a backup starts and ends
// (BACKUP_STATUS), and the main window shows it as a notice (BackupNotices).

/** Back Up Database…: a save panel starting in the backup folder, then the backup. */
export async function backUp(): Promise<void> {
  const suggestion = await backupSuggestion().catch(() => "Folderbase Backup.zip");
  const destination = await pickBackupDestination(suggestion);
  if (!destination) return;
  // A failure shows in the notice
  await backUpDatabase(destination).catch(() => {});
}

/** Restore from Backup…: pick a backup, check it, ask, then restore (Folderbase restarts). */
export async function restore(): Promise<void> {
  const suggestion = await backupSuggestion().catch(() => null);
  const folder = suggestion ? suggestion.replace(/[\\/][^\\/]*$/, "") : undefined;
  const path = await pickBackupFile(folder);
  if (!path) return;
  let info;
  try {
    info = await inspectBackup(path);
  } catch (e) {
    await message(String(e), { title: "This backup can’t be restored", kind: "error" });
    return;
  }
  const { title, message: text } = restoreQuestion(info, backupDate(info.manifest.created_at));
  const ok = await ask(text, { title, okLabel: "Restore", cancelLabel: "Cancel", kind: "warning" });
  if (!ok) return;
  try {
    await restoreFromBackup(path);
  } catch (e) {
    await message(String(e), { title: "Couldn’t restore the backup", kind: "error" });
  }
}

/**
 * Asks where backups should go, once: a synced folder keeps a copy off this
 * Mac. Choosing nothing leaves them in Folderbase's own folder. Resolves to the
 * folder chosen, or null.
 */
export async function askForBackupFolder(): Promise<string | null> {
  const choose = await ask(
    "Backups are kept on this Mac for now. A folder that syncs, such as OneDrive or pCloud, keeps a copy somewhere else too. Each backup is written once and left alone, so a synced folder is safe.",
    { title: "Where should Folderbase keep backups?", okLabel: "Choose Folder…", cancelLabel: "Not Now", kind: "info" }
  );
  const folder = choose ? await pickDirectory() : null;
  if (folder) {
    await setBackupFolder(folder);
    return folder;
  }
  await setAppSettings({ backup: { folder_asked: true } });
  return null;
}

/** A backup's notice in the main window. */
export interface BackupJob {
  id: string;
  state: "running" | "done" | "failed";
  /** Made before a restore, rather than asked for. */
  beforeRestore: boolean;
  path?: string;
  error?: string;
  /** Hovered: it doesn't go by itself. */
  keep?: boolean;
}

let jobs: BackupJob[] = [];
const listeners = new Set<() => void>();
const setJobs = (next: BackupJob[]) => {
  jobs = next;
  listeners.forEach((l) => l());
};
const DONE_NOTICE_MS = 8000;

/** Turns Rust's backup events into notices (the main window only). */
function apply(status: BackupStatus) {
  if (status.state === "running") {
    setJobs([...jobs.filter((j) => j.id !== status.job), { id: status.job, state: "running", beforeRestore: status.before_restore }]);
    return;
  }
  const known = jobs.find((j) => j.id === status.job);
  const base = known ?? { id: status.job, beforeRestore: false };
  const next: BackupJob =
    status.state === "done" ? { ...base, state: "done", path: status.path } : { ...base, state: "failed", error: status.error };
  setJobs(known ? jobs.map((j) => (j.id === status.job ? next : j)) : [...jobs, next]);
  if (status.state === "done") {
    window.setTimeout(() => {
      if (!jobs.find((j) => j.id === status.job)?.keep) backupJobs.dismiss(status.job);
    }, DONE_NOTICE_MS);
  }
}

export const backupJobs = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  snapshot: () => jobs,
  /** Starts hearing backups; resolves to the function that stops. */
  listen: () => listen<BackupStatus>(BACKUP_STATUS, (e) => apply(e.payload)),
  dismiss: (id: string) => setJobs(jobs.filter((j) => j.id !== id)),
  keep: (id: string) => setJobs(jobs.map((j) => (j.id === id ? { ...j, keep: true } : j))),
  reveal: (path: string) => void revealPaths([path]).catch(() => {}),
};
