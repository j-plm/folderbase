import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_ARRANGEMENT,
  GROUP_OPTIONS,
  SORT_OPTIONS,
  defaultDirection,
  isPropertyGroup,
  type Arrangement,
  type GroupBy,
  type PropertyGrouping,
  type SortKey,
} from "../lib/arrange";
import { propName } from "../lib/fileColumns";
import { groupByColumn } from "../lib/propertyGroups";
import { propertyLabel } from "../lib/propertyTypes";
import { useBrowse } from "./BrowseContext";
import { toggleSort } from "../lib/columns";
import type { MenuEntry } from "../lib/nativeMenu";

const STORAGE_KEY = "arrangement";

function load(): Arrangement {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved?.sort?.key && saved?.groupBy) return saved;
  } catch {}
  return DEFAULT_ARRANGEMENT;
}

interface ArrangementContextValue {
  arrangement: Arrangement;
  /** Sort By menu: pick a key with its Finder default direction. */
  setSortKey: (key: SortKey) => void;
  /** Header click: same key flips direction. */
  toggleSortKey: (key: SortKey) => void;
  setGroupBy: (groupBy: GroupBy) => void;
}

const ArrangementContext = createContext<ArrangementContextValue | null>(null);

/** Sort and grouping shared by the Icons, List and Columns views; persisted. */
export function ArrangementProvider({ children }: { children: ReactNode }) {
  const [arrangement, setArrangement] = useState<Arrangement>(load);

  const update = useCallback((next: (a: Arrangement) => Arrangement) => {
    setArrangement((prev) => {
      const value = next(prev);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      return value;
    });
  }, []);

  const value: ArrangementContextValue = {
    arrangement,
    setSortKey: (key) => update((a) => ({ ...a, sort: { key, direction: defaultDirection(key) } })),
    toggleSortKey: (key) =>
      update((a) => ({ ...a, sort: toggleSort(a.sort, key) as Arrangement["sort"] })),
    setGroupBy: (groupBy) => update((a) => ({ ...a, groupBy })),
  };

  return <ArrangementContext.Provider value={value}>{children}</ArrangementContext.Provider>;
}

export function useArrangement(): ArrangementContextValue {
  const ctx = useContext(ArrangementContext);
  if (!ctx) throw new Error("useArrangement must be used inside ArrangementProvider");
  return ctx;
}

/**
 * The arrangement as the location showing can use it: grouping by a property
 * it doesn't have is no grouping, and grouping by one it has comes with how
 * to read it.
 */
export function useArrangedBy(): {
  arrangement: Arrangement;
  byProperty?: PropertyGrouping;
  /** Grouped by a property of one value (Select, Text, Number): each heading is a value, so it takes drops. */
  groupsTakeDrops: boolean;
} {
  const { arrangement } = useArrangement();
  const browse = useBrowse();
  const properties = browse?.groupProperties;
  const grouping = browse?.grouping;
  const typeOf = browse?.dropContext?.typeOf;
  return useMemo(() => {
    const { groupBy } = arrangement;
    if (!isPropertyGroup(groupBy)) return { arrangement, groupsTakeDrops: false };
    if (!grouping || !properties?.includes(groupBy)) return { arrangement: { ...arrangement, groupBy: "none" }, groupsTakeDrops: false };
    const single = !!typeOf && ["enum", "free_text", "number"].includes(typeOf(propName(groupBy)));
    return { arrangement, byProperty: grouping, groupsTakeDrops: single };
  }, [arrangement, properties, grouping, typeOf]);
}

/** The location's properties to group by (none outside a location). */
export function useGroupProperties(): string[] {
  return useBrowse()?.groupProperties ?? NO_PROPERTIES;
}

const NO_PROPERTIES: string[] = [];

/** Group By's properties ("prop:Client"), after Finder's groups: a section each for Custom and Media. */
export function propertyGroupEntries({ arrangement, setGroupBy }: ArrangementContextValue, properties: string[]): MenuEntry[] {
  return groupByColumn(properties, (c) => c).flatMap(({ label, items }): MenuEntry[] => [
    { type: "separator" },
    { type: "header", text: label },
    ...items.map(
      (c): MenuEntry => ({
        type: "check",
        text: propertyLabel(propName(c)),
        checked: arrangement.groupBy === c,
        action: () => setGroupBy(c as GroupBy),
      })
    ),
  ]);
}

/**
 * Native menu entries for Group By / Sort By (toolbar button and background
 * right-click). Group By offers Finder's groups, then `properties` (the
 * location's, as "prop:Client"), sectioned as every list of properties is.
 */
export function arrangementMenu(ctx: ArrangementContextValue, properties: string[] = []): MenuEntry[] {
  const { arrangement, setGroupBy, setSortKey } = ctx;
  return [
    {
      type: "submenu",
      text: "Group By",
      items: [
        ...GROUP_OPTIONS.map(
          (o): MenuEntry => ({ type: "check", text: o.label, checked: arrangement.groupBy === o.key, action: () => setGroupBy(o.key) })
        ),
        ...propertyGroupEntries(ctx, properties),
      ],
    },
    {
      type: "submenu",
      text: "Sort By",
      items: SORT_OPTIONS.map((o) => ({
        type: "check" as const,
        text: o.label,
        checked: arrangement.sort.key === o.key,
        action: () => setSortKey(o.key),
      })),
    },
  ];
}
