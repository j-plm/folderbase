import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { BACKUP_FOLDER_WANTED } from "../lib/commands";
import { askForBackupFolder, backUp, restore } from "../lib/backupActions";

/**
 * File ▸ Back Up Database… and Restore from Backup…, which Rust sends to the
 * window in front (main or Settings), so their panels open over it. In the main
 * window, also asks where backups go after the first automatic one.
 */
export function useBackupMenu({ main }: { main: boolean }) {
  useEffect(() => {
    const unlisteners = [listen("menu-back-up", () => void backUp()), listen("menu-restore", () => void restore())];
    if (main) unlisteners.push(listen(BACKUP_FOLDER_WANTED, () => void askForBackupFolder()));
    return () => unlisteners.forEach((u) => void u.then((f) => f()));
  }, [main]);
}
