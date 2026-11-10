import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { columnSymbol } from "../folders/HierarchyLevels";
import { NewPropertyPill, PropertyPill } from "../folders/PropertyPill";
import { PROP_PREFIX } from "../../lib/fileColumns";
import { propertyLabel } from "../../lib/propertyTypes";
import type { ValueType } from "../../types";

/** Room the fade takes at an edge with more pills past it. */
const FADE = 18;

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
  onApply: (name: string) => void;
  onMenu: (e: React.MouseEvent, name: string) => void;
  onNewProperty: () => void;
}

/**
 * A level's properties as one row of pills that scrolls sideways (the wheel
 * scrolls it too). Clicking one names the level's folders with it; the one
 * they already carry is ticked and pinned at the start of the row.
 */
export default function PropertyStrip({ properties, typeOf, current, present, conditionOf, onApply, onMenu, onNewProperty }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  function measure() {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The pinned pill comes and goes, changing the row's room
  useEffect(measure, [current]);

  const mask = `linear-gradient(to right, ${edges.left ? "transparent" : "black"}, black ${FADE}px, black calc(100% - ${FADE}px), ${
    edges.right ? "transparent" : "black"
  })`;

  const pill = (name: string) => (
    <PropertyPill
      key={name}
      symbol={columnSymbol(PROP_PREFIX + name, typeOf)}
      label={propertyLabel(name)}
      state={name === current ? "current" : present.has(name) ? "used" : "default"}
      title={conditionOf(name)}
      onClick={() => onApply(name)}
      onContextMenu={(e) => onMenu(e, name)}
      className="shrink-0 cursor-default whitespace-nowrap"
    />
  );

  return (
    <div data-no-heading-click className="flex items-center gap-1 min-w-0">
      {/* The level's own property stays put at the start; the rest scroll beside it */}
      {current && pill(current)}
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
        {properties.filter((name) => name !== current).map(pill)}
        <NewPropertyPill onClick={onNewProperty} className="shrink-0" />
      </div>
    </div>
  );
}
