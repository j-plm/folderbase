import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { menuMetrics } from "./platform";

/**
 * In the app's own menus (MenuPopover), an entry can offer deleting what it
 * stands for: a bin on hover, then an inline confirmation. Native menus ignore it.
 */
export interface MenuDelete {
  /** The confirmation shown in the row, e.g. "Delete “Client” from 12 files?". */
  confirm: string;
  action: () => void;
}

export type MenuEntry =
  /** `key` identifies an entry for `alignKey`. */
  | { type: "check"; text: string; checked: boolean; enabled?: boolean; action: () => void; key?: string; onDelete?: MenuDelete }
  | { type: "item"; text: string; enabled?: boolean; action: () => void; key?: string; onDelete?: MenuDelete }
  | { type: "submenu"; text: string; items: MenuEntry[] }
  | { type: "separator" };

function buildItems(entries: MenuEntry[]): Promise<Array<CheckMenuItem | MenuItem | PredefinedMenuItem | Submenu>> {
  return Promise.all(
    entries.map(async (entry) => {
      switch (entry.type) {
        case "check":
          return CheckMenuItem.new({
            text: entry.text,
            checked: entry.checked,
            enabled: entry.enabled ?? true,
            action: entry.action,
          });
        case "item":
          return MenuItem.new({ text: entry.text, enabled: entry.enabled ?? true, action: entry.action });
        case "submenu":
          return Submenu.new({ text: entry.text, items: await buildItems(entry.items) });
        case "separator":
          return PredefinedMenuItem.new({ item: "Separator" });
      }
    })
  );
}

/**
 * Distance from the menu's top edge to the middle of `entries[index]`, given
 * native row heights.
 */
export function menuItemCenter(
  entries: MenuEntry[],
  index: number,
  metrics: { item: number; separator: number; padding: number }
): number {
  const above = entries
    .slice(0, index)
    .reduce((sum, e) => sum + (e.type === "separator" ? metrics.separator : metrics.item), 0);
  return metrics.padding + above + metrics.item / 2;
}

interface PopupOptions {
  /**
   * With the mouse event that opened the menu: shift the menu up so the entry
   * with this key sits under the pointer, as AppKit does for pop-up buttons.
   */
  alignKey?: string;
  event?: { clientX: number; clientY: number };
}

/** Shows a native OS context menu at the mouse position. */
export async function showContextMenu(entries: MenuEntry[], options: PopupOptions = {}): Promise<void> {
  const menu = await Menu.new({ items: await buildItems(entries) });
  const { alignKey, event } = options;
  const index = alignKey ? entries.findIndex((e) => "key" in e && e.key === alignKey) : -1;
  if (event && menuMetrics && index !== -1) {
    const y = event.clientY - menuItemCenter(entries, index, menuMetrics);
    // The OS keeps the menu on screen if this would push it past the top
    await menu.popup(new LogicalPosition(event.clientX, y));
    return;
  }
  await menu.popup();
}
