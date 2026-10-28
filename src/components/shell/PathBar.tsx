import type { ReactNode } from "react";
import { SymbolIcon } from "../../lib/fileIcons";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";

export interface PathSegment {
  label: string;
  icon: ReactNode;
  /** A click goes there. */
  onOpen?: () => void;
  /** What sits beside it, shown on a right-click; the entry keyed `menuKey` opens under the pointer. */
  menu?: () => MenuEntry[] | Promise<MenuEntry[]>;
  menuKey?: string;
}

/**
 * Finder's path bar (View ▸ Show Path Bar), along the bottom of the window:
 * where you are, from the location down to the folder you're in. A click on a
 * segment goes there; a right-click shows what sits beside it at the same
 * level (other locations, other saved views, other folders) to go to instead.
 */
export default function PathBar({ segments }: { segments: PathSegment[] }) {
  // Finder (macOS 26), measured: a 28pt bar under a hairline, 12pt secondary text,
  // 14pt icons, and a small chevron with 6pt either side
  return (
    <nav
      aria-label="Path"
      data-keys-to-browse
      className="flex items-center h-[28px] pl-3 pr-2.5 shrink-0 overflow-hidden border-t border-neutral-700/60 bg-neutral-900 text-[12px] text-neutral-500 select-none cursor-default"
    >
      {segments.map((segment, i) => (
        <span key={i} className="flex items-center min-w-0 shrink last:shrink-0">
          {i > 0 && <SymbolIcon name="chevron.right" size={9} fallback="›" className="shrink-0 mx-1.5 text-neutral-500" />}
          <span
            onClick={segment.onOpen}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!segment.menu) return;
              Promise.resolve(segment.menu())
                .then((entries) => showContextMenu(entries, { event: e, alignKey: segment.menuKey }))
                .catch(() => {});
            }}
            title={segment.label}
            className="flex items-center gap-[5px] min-w-0"
          >
            <span className="shrink-0 flex">{segment.icon}</span>
            <span className="truncate">{segment.label}</span>
          </span>
        </span>
      ))}
    </nav>
  );
}
