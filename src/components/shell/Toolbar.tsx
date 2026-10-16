import { useNavigation } from "../../contexts/NavigationContext";
import Breadcrumb from "./Breadcrumb";
import { selectionLabel, useSelectionStatus } from "../../lib/selectionStatus";
import OverflowBar from "./OverflowBar";
import { arrangementMenu, useArrangement } from "../../contexts/ArrangementContext";
import { GROUP_OPTIONS, SORT_OPTIONS } from "../../lib/arrange";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import { SymbolIcon } from "../../lib/fileIcons";
import type { ViewMode } from "../../types/navigation";

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "tiles", label: "Tiles" },
  { mode: "list", label: "List" },
  { mode: "columns", label: "Columns" },
  { mode: "database", label: "Database" },
];

export default function Toolbar() {
  const { viewMode, setViewMode } = useNavigation();
  const arrangementCtx = useArrangement();
  const { arrangement, setGroupBy, setSortKey } = arrangementCtx;
  const selectedLabel = selectionLabel(useSelectionStatus());

  // Finder's group button: grouping options, then Sort By.
  const groupButtonMenu: MenuEntry[] = [
    ...GROUP_OPTIONS.flatMap((o): MenuEntry[] => {
      const item: MenuEntry = {
        type: "check",
        text: o.label,
        checked: arrangement.groupBy === o.key,
        action: () => setGroupBy(o.key),
      };
      return o.key === "none" ? [item, { type: "separator" }] : [item];
    }),
    { type: "separator" },
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

  return (
    <div
      data-tauri-drag-region
      style={{ paddingLeft: "calc(var(--sidebar-inset) + 16px)" }}
      className="flex items-center gap-3 px-4 h-[52px] border-b border-neutral-700/60 bg-neutral-900 shrink-0"
    >
      <div data-tauri-drag-region className="flex-1 min-w-[80px] flex items-baseline gap-2.5">
        <Breadcrumb viewName="Folderbase" />
        {selectedLabel && (
          <span data-tauri-drag-region className="shrink-0 text-xs text-neutral-500 whitespace-nowrap tabular-nums">
            {selectedLabel}
          </span>
        )}
      </div>

      <OverflowBar
        dragRegion
        items={[
          {
            id: "view-mode",
            node: (
              <div className="flex items-center gap-px bg-neutral-800 dark:bg-neutral-700/60 rounded-md p-0.5">
                {VIEW_MODES.map(({ mode, label }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`px-2.5 py-0.5 text-xs rounded-[5px] whitespace-nowrap ${
                      viewMode === mode
                        ? "bg-white dark:bg-neutral-500/70 text-neutral-100 shadow-sm"
                        : "text-neutral-300 hover:text-neutral-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ),
            menu: [
              {
                type: "submenu",
                text: "View",
                items: VIEW_MODES.map(({ mode, label }) => ({
                  type: "check" as const,
                  text: `as ${label}`,
                  checked: viewMode === mode,
                  action: () => setViewMode(mode),
                })),
              },
            ],
          },
          ...(viewMode === "database"
            ? []
            : [
                {
                  id: "arrange",
                  node: (
                    <button
                      onClick={() => showContextMenu(groupButtonMenu)}
                      title="Change item grouping"
                      className={`flex items-center gap-1 h-[26px] px-2 rounded-md text-neutral-300 hover:bg-neutral-700/60 ${
                        arrangement.groupBy !== "none" ? "bg-neutral-700/60" : ""
                      }`}
                    >
                      <SymbolIcon
                        name="square.grid.3x2"
                        size={20}
                        fallback={
                          <svg viewBox="0 0 19 13" className="w-[19px] h-[13px]" fill="none" stroke="currentColor" strokeWidth="1.2">
                            {[0.6, 7, 13.4].flatMap((x) =>
                              [0.6, 7.4].map((y) => (
                                <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" rx="1.3" />
                              ))
                            )}
                          </svg>
                        }
                      />
                      <SymbolIcon name="chevron.down" size={9} />
                    </button>
                  ),
                  menu: arrangementMenu(arrangementCtx),
                },
              ]),
        ]}
      />
    </div>
  );
}
