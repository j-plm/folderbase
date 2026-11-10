import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { columnSymbol } from "../folders/HierarchyLevels";
import { NewPropertyPill, PropertyPill } from "../folders/PropertyPill";
import { PROP_PREFIX } from "../../lib/fileColumns";
import { SymbolIcon } from "../../lib/fileIcons";
import { propertyLabel } from "../../lib/propertyTypes";
import type { ValueType } from "../../types";

/** Room the fade takes at an edge with more pills past it. */
const FADE = 18;
/** Narrower than this beside the pinned pill, a scrolling row shows too little to be of use. */
const MIN_ROW = 120;

interface Props {
  /** Properties a folder name can be a value of, in order. */
  properties: string[];
  typeOf: (name: string) => ValueType;
  /** The name the level's targets share. */
  current: string | null;
  /** Names some of the targets carry, when they differ. */
  present: Set<string>;
  /** "Only where …", for a conditional property. */
  conditionOf: (name: string) => string | undefined;
  /** When too narrow for a row, the rest fold away behind a toggle and open as wrapped lines beneath. */
  collapsible?: boolean;
  onApply: (name: string) => void;
  onMenu: (e: React.MouseEvent, name: string) => void;
  onNewProperty: () => void;
}

/**
 * A level's properties as one row of pills that scrolls sideways (the wheel
 * scrolls it too). Clicking one names the level's folders with it; the one
 * they already carry is ticked and pinned at the start of the row.
 */
export default function PropertyStrip({
  properties,
  typeOf,
  current,
  present,
  conditionOf,
  collapsible = false,
  onApply,
  onMenu,
  onNewProperty,
}: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLSpanElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [narrow, setNarrow] = useState(false);
  const [open, setOpen] = useState(false);

  function measure() {
    const outer = outerRef.current;
    if (outer && collapsible) {
      const room = outer.clientWidth - (pinnedRef.current?.offsetWidth ?? 0);
      setNarrow(room < MIN_ROW);
    }
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }

  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsible]);

  // The pinned pill comes and goes, and the row's length changes, changing what fits
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(measure, [current, properties, narrow]);

  const mask = `linear-gradient(to right, ${edges.left ? "transparent" : "black"}, black ${FADE}px, black calc(100% - ${FADE}px), ${
    edges.right ? "transparent" : "black"
  })`;

  const pill = (name: string, fit = false) => (
    <PropertyPill
      key={name}
      symbol={columnSymbol(PROP_PREFIX + name, typeOf)}
      label={propertyLabel(name)}
      state={name === current ? "current" : present.has(name) ? "used" : "default"}
      title={conditionOf(name)}
      onClick={() => onApply(name)}
      onContextMenu={(e) => onMenu(e, name)}
      className={`${fit ? "min-w-0 max-w-full" : "shrink-0"} cursor-default whitespace-nowrap`}
    />
  );
  const others = properties.filter((name) => name !== current);

  if (collapsible && narrow) {
    return (
      <div ref={outerRef} data-no-heading-click className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          {current && (
            // Squeezed only when the column can't hold it beside the toggle, which keeps it narrow
            <span ref={pinnedRef} className="min-w-0 max-w-[calc(100%-36px)] flex">
              {pill(current, true)}
            </span>
          )}
          <button
            type="button"
            aria-expanded={open}
            title={open ? "Hide Properties" : "Show Properties"}
            onClick={() => setOpen(!open)}
            className="shrink-0 flex items-center gap-1 h-[22px] px-2 rounded-full border border-neutral-600 text-[12px] text-neutral-300 hover:border-neutral-500"
          >
            {!current && "Property"}
            <SymbolIcon name={open ? "chevron.up" : "chevron.down"} size={9} fallback={open ? "▴" : "▾"} />
          </button>
        </div>
        {open && (
          <div className="flex flex-wrap gap-1">
            {others.map((name) => pill(name))}
            <NewPropertyPill onClick={onNewProperty} className="shrink-0" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={outerRef} data-no-heading-click className="flex items-center gap-1 min-w-0">
      {/* The level's own property stays put at the start; the rest scroll beside it */}
      {current && (
        <span ref={pinnedRef} className="shrink-0 flex">
          {pill(current)}
        </span>
      )}
      <div
        ref={ref}
        onScroll={measure}
        onWheel={(e) => {
          // A plain wheel scrolls the row sideways
          if (ref.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current.scrollLeft += e.deltaY;
        }}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto scrollbar-none"
      >
        {others.map((name) => pill(name))}
        <NewPropertyPill onClick={onNewProperty} className="shrink-0" />
      </div>
    </div>
  );
}
