import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import {
  DEFAULT_ARRANGEMENT,
  GROUP_OPTIONS,
  SORT_OPTIONS,
  defaultDirection,
  type Arrangement,
  type GroupBy,
  type SortKey,
} from "../lib/arrange";
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

/** Sort and grouping shared by the Tiles, List and Columns views; persisted. */
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

/** Native menu entries for Group By / Sort By (toolbar button and background right-click). */
export function arrangementMenu({ arrangement, setGroupBy, setSortKey }: ArrangementContextValue): MenuEntry[] {
  return [
    {
      type: "submenu",
      text: "Group By",
      items: GROUP_OPTIONS.map((o) => ({
        type: "check" as const,
        text: o.label,
        checked: arrangement.groupBy === o.key,
        action: () => setGroupBy(o.key),
      })),
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
