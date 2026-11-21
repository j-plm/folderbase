import { useEffect, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import Dialog, { DialogButton } from "../shared/Dialog";
import { appSettings, chooseZipFolder, folderName, resetZipFolder, zipFolder } from "../../lib/appSettings";
import { FolderIcon, SymbolIcon } from "../../lib/fileIcons";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import { hasPrimaryModifier, platform } from "../../lib/platform";

/**
 * Settings (Folderbase ▸ Settings…, ⌘,; Ctrl+, elsewhere): app-wide choices.
 * For now, where Compress saves zips, as a pop-up of Downloads, the folder
 * chosen, and Other…, as Safari picks where downloads go.
 */
export default function SettingsWindow() {
  const state = useSyncExternalStore(appSettings.subscribe, appSettings.snapshot);

  useEffect(() => {
    void appSettings.load();
    const unlisten = listen("menu-settings", () => appSettings.setOpen(true));
    // macOS has the menu item's shortcut; elsewhere there's no app menu to carry it
    const onKey = (e: KeyboardEvent) => {
      if (platform !== "macos" && hasPrimaryModifier(e) && e.key === ",") {
        e.preventDefault();
        appSettings.setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      void unlisten.then((f) => f());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!state.open) return null;
  const close = () => appSettings.setOpen(false);
  const chosen = state.settings.zip_folder;

  const folderMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const entries: MenuEntry[] = [
      { type: "check", text: folderName(state.downloads), checked: !chosen, key: "downloads", action: () => void resetZipFolder() },
      ...(chosen ? [{ type: "check" as const, text: folderName(chosen), checked: true, key: "chosen", action: () => {} }] : []),
      { type: "separator" },
      { type: "item", text: "Other…", action: () => void chooseZipFolder() },
    ];
    // Opens over the button with the current folder under the pointer, as a pop-up button does
    void showContextMenu(entries, { alignKey: chosen ? "chosen" : "downloads", event: { clientX: rect.left, clientY: rect.top + rect.height / 2 } });
  };

  return (
    <Dialog
      title="Settings"
      onCancel={close}
      onSubmit={close}
      footer={
        <div className="ml-auto">
          <DialogButton variant="default">Done</DialogButton>
        </div>
      }
    >
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
        <span className="text-right">Save zips in:</span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={folderMenu}
          title={zipFolder(state) ?? undefined}
          className="justify-self-start inline-flex items-center gap-1.5 h-6 pl-1.5 pr-1 max-w-full rounded-[6px] bg-neutral-700/70 text-neutral-100 active:bg-neutral-700"
        >
          <FolderIcon size={16} />
          <span className="truncate">{folderName(zipFolder(state))}</span>
          <SymbolIcon name="chevron.up.chevron.down" size={9} fallback="⌃" />
        </button>
        <span />
        <p className="text-[12px] text-neutral-400">
          Where Compress puts zips. Hold {platform === "macos" ? "⌥" : "Alt"} as you right-click to choose a place each time.
        </p>
      </div>
    </Dialog>
  );
}
