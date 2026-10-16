import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MenuEntry } from "../../lib/nativeMenu";
import { SymbolIcon } from "../../lib/fileIcons";

/** A button to drop down from, or a point (a right-click) to open at. */
export type MenuAnchor = HTMLElement | { x: number; y: number };

interface Props {
  /** Clicks on an anchor button are left to its own handler. */
  anchor: MenuAnchor;
  entries: MenuEntry[];
  onClose: () => void;
}

/** Gap between the anchor and the popover, and from the window edges. */
const MARGIN = 6;
/** Panel padding: a submenu's first row lines up with the row that opened it. */
const PADDING = 5;
/** How long the pointer may be outside the menu before it closes. */
const LEAVE_DELAY = 300;

const PANEL =
  "fixed z-50 min-w-[200px] overflow-y-auto p-[5px] rounded-[12px] bg-neutral-900/80 dark:bg-neutral-800/80 backdrop-blur-2xl backdrop-saturate-150 border border-neutral-700/60 shadow-xl text-body text-neutral-100";

/**
 * A menu-styled panel for ticking several options in a row. Native menus close
 * on every click, so like Finder's View Options this stays open while you tick
 * items, and closes when the pointer leaves it (after having been inside), you
 * click away or press Escape. Check items toggle in place; plain items run and
 * close. Submenus open to the side on hover and behave the same way.
 */
export default function MenuPopover({ anchor, entries, onClose }: Props) {
  const panels = useRef(new Set<HTMLElement>());
  const [pos, setPos] = useState<React.CSSProperties | null>(null);

  // Drop down from a button, right edges aligned; or open at a point, as a
  // context menu does. Never past the window bottom.
  useLayoutEffect(() => {
    function place() {
      if (anchor instanceof HTMLElement) {
        const r = anchor.getBoundingClientRect();
        const top = r.bottom + MARGIN;
        setPos({ top, right: Math.max(MARGIN, window.innerWidth - r.right), maxHeight: window.innerHeight - top - MARGIN });
      } else {
        const top = Math.min(anchor.y, window.innerHeight - MARGIN - 200);
        setPos({ top, left: Math.min(anchor.x, window.innerWidth - MARGIN - 200), maxHeight: window.innerHeight - top - MARGIN });
      }
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      ((anchor instanceof HTMLElement && anchor.contains(target)) || [...panels.current].some((p) => p.contains(target)));
    let entered = false;
    let timer: number | undefined;

    function onMouseDown(e: MouseEvent) {
      if (!inside(e.target)) onClose();
    }
    function onMouseMove(e: MouseEvent) {
      if (inside(e.target)) {
        entered = true;
        window.clearTimeout(timer);
        timer = undefined;
      } else if (entered && timer === undefined) {
        // Only once the pointer has been inside: a menu opened at a point starts under it
        timer = window.setTimeout(onClose, LEAVE_DELAY);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [anchor, onClose]);

  if (!pos) return null;

  return createPortal(<Panel entries={entries} style={pos} panels={panels.current} onClose={onClose} />, document.body);
}

function Panel({
  entries,
  style,
  panels,
  onClose,
}: {
  entries: MenuEntry[];
  style: React.CSSProperties;
  panels: Set<HTMLElement>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** The open submenu: its index and the row it opens from. */
  const [sub, setSub] = useState<{ index: number; row: DOMRect } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    panels.add(el);
    return () => {
      panels.delete(el);
    };
  }, [panels]);

  const open = sub && entries[sub.index];

  return (
    <>
      <div ref={ref} role="menu" style={style} className={PANEL}>
        {entries.map((entry, i) => {
          if (entry.type === "separator") {
            return <div key={i} className="mx-2.5 my-[5px] h-px bg-neutral-700/80" />;
          }
          if (entry.type === "submenu") {
            const active = sub?.index === i;
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={active}
                onMouseEnter={(e) => setSub({ index: i, row: e.currentTarget.getBoundingClientRect() })}
                onClick={(e) => setSub({ index: i, row: e.currentTarget.getBoundingClientRect() })}
                className={`w-full h-6 flex items-center gap-1 pl-1.5 pr-2 rounded-[6px] text-left whitespace-nowrap ${
                  active ? "bg-blue-500 text-white" : ""
                }`}
              >
                <span className="w-4 shrink-0" />
                <span className="flex-1">{entry.text}</span>
                <SymbolIcon name="chevron.right" size={10} fallback="›" />
              </button>
            );
          }
          const enabled = entry.enabled ?? true;
          return (
            <button
              key={i}
              type="button"
              role={entry.type === "check" ? "menuitemcheckbox" : "menuitem"}
              aria-checked={entry.type === "check" ? entry.checked : undefined}
              disabled={!enabled}
              onMouseEnter={() => setSub(null)}
              onClick={() => {
                entry.action();
                if (entry.type === "item") onClose();
              }}
              className="w-full h-6 flex items-center gap-1 pl-1.5 pr-4 rounded-[6px] text-left whitespace-nowrap enabled:hover:bg-blue-500 enabled:hover:text-white disabled:text-neutral-500"
            >
              <span className="w-4 flex justify-center shrink-0">
                {entry.type === "check" && entry.checked && <SymbolIcon name="checkmark" size={11} fallback="✓" />}
              </span>
              {entry.text}
            </button>
          );
        })}
      </div>
      {open && open.type === "submenu" && sub && (
        <Submenu key={sub.index} entries={open.items} row={sub.row} panels={panels} onClose={onClose} />
      )}
    </>
  );
}

/** A submenu panel beside its row: to the right, or to the left when there's no room. */
function Submenu({
  entries,
  row,
  panels,
  onClose,
}: {
  entries: MenuEntry[];
  row: DOMRect;
  panels: Set<HTMLElement>;
  onClose: () => void;
}) {
  const probe = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties | null>(null);

  // Measure an invisible copy first, then place the real panel
  useLayoutEffect(() => {
    const el = probe.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const right = row.right + PADDING + width <= window.innerWidth - MARGIN;
    const left = right ? row.right + PADDING : Math.max(MARGIN, row.left - PADDING - width);
    const top = Math.max(MARGIN, Math.min(row.top - PADDING - 1, window.innerHeight - MARGIN - height));
    setStyle({ left, top, maxHeight: window.innerHeight - top - MARGIN });
  }, [row]);

  if (!style) {
    return (
      <div ref={probe} aria-hidden style={{ left: 0, top: 0, visibility: "hidden" }} className={PANEL}>
        {entries.map((e, i) =>
          e.type === "separator" ? (
            <div key={i} className="my-[5px] h-px" />
          ) : (
            <div key={i} className="h-6 pl-[26px] pr-4 whitespace-nowrap">
              {e.text}
            </div>
          )
        )}
      </div>
    );
  }
  return <Panel entries={entries} style={style} panels={panels} onClose={onClose} />;
}
