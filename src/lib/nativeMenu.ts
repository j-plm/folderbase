import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

export type MenuEntry =
  | { type: "check"; text: string; checked: boolean; enabled?: boolean; action: () => void }
  | { type: "item"; text: string; enabled?: boolean; action: () => void }
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

/** Shows a native OS context menu at the mouse position. */
export async function showContextMenu(entries: MenuEntry[]): Promise<void> {
  const menu = await Menu.new({ items: await buildItems(entries) });
  await menu.popup();
}
