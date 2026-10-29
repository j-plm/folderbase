import { useNavigation } from "../../contexts/NavigationContext";
import { selectionLabel, useSelectionStatus } from "../../lib/selectionStatus";
import OverflowBar from "./OverflowBar";
import ViewsButton, { viewsSubmenu } from "./ViewsButton";
import { useOptionalLocationViews } from "../../contexts/LocationViewsContext";
import { useBrowse } from "../../contexts/BrowseContext";
import { arrangementMenu, propertyGroupEntries, useArrangement, useGroupProperties } from "../../contexts/ArrangementContext";
import { GROUP_OPTIONS, SORT_OPTIONS } from "../../lib/arrange";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import { SymbolIcon } from "../../lib/fileIcons";
import type { ViewMode } from "../../types/navigation";
import { useSaveViewShortcut } from "../../hooks/useSaveViewShortcut";

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "database", label: "Database" },
  { mode: "tiles", label: "Icons" },
  { mode: "list", label: "List" },
  { mode: "columns", label: "Columns" },
];

export default function Toolbar() {
  const { viewMode, setViewMode, activeLocationId, editHierarchy, setEditHierarchy } = useNavigation();
  const arrangementCtx = useArrangement();
  const { arrangement, setGroupBy, setSortKey } = arrangementCtx;
  const groupProperties = useGroupProperties();
  const selectedLabel = selectionLabel(useSelectionStatus());
  const locationViews = useOptionalLocationViews();
  useSaveViewShortcut(locationViews);
  const browse = useBrowse();
  const activeView = locationViews?.active;
  // Finder's title: the folder you're in; at the top, the view (the location itself, for its default view)
  const title = !browse || !activeView
    ? "Folderbase"
    : (browse.steps[browse.steps.length - 1]?.label ?? (activeView.is_default ? (browse.locationName ?? "") : activeView.name));

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
    ...propertyGroupEntries(arrangementCtx, groupProperties),
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
      data-keys-to-browse
      style={{ paddingLeft: "calc(var(--sidebar-inset) + 16px)" }}
      className="flex items-center gap-3 px-4 h-[52px] border-b border-neutral-700/60 bg-neutral-900 shrink-0"
    >
      <div data-tauri-drag-region className="flex-1 min-w-[80px] flex items-baseline gap-2.5">
        {browse && (
          <div className="flex items-center gap-1 shrink-0 self-center">
            <HistoryButton symbol="chevron.left" fallback="‹" label="Back" enabled={browse.canBack} onClick={browse.back} />
            <HistoryButton symbol="chevron.right" fallback="›" label="Forward" enabled={browse.canForward} onClick={browse.forward} />
          </div>
        )}
        <span data-tauri-drag-region className="min-w-0 truncate text-[15px] font-semibold text-neutral-100">
          {title}
        </span>
        {selectedLabel && (
          <span data-tauri-drag-region className="shrink-0 text-xs text-neutral-500 whitespace-nowrap tabular-nums">
            {selectedLabel}
          </span>
        )}
      </div>

      <OverflowBar
        dragRegion
        items={[
          ...(locationViews
            ? [{ id: "views", node: <ViewsButton />, menu: [viewsSubmenu(locationViews)] }]
            : []),
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
                  menu: arrangementMenu(arrangementCtx, groupProperties),
                },
              ]),
          // New Folder, where the folder you're in has a level that takes a typed value
          ...(browse?.newFolderHere && viewMode !== "database"
            ? [
                {
                  id: "new-folder",
                  node: (
                    <button
                      onClick={() => browse.setNewFolderOpen(true)}
                      title="New Folder"
                      aria-label="New Folder"
                      className="flex items-center h-[26px] px-2 rounded-md text-neutral-300 hover:bg-neutral-700/60"
                    >
                      <SymbolIcon name="folder.badge.plus" size={18} fallback="+" />
                    </button>
                  ),
                  menu: [{ type: "item" as const, text: "New Folder", action: () => browse.setNewFolderOpen(true) }],
                },
              ]
            : []),
          ...(activeLocationId
            ? [
                {
                  id: "hierarchy",
                  node: (
                    <button
                      onClick={() => setEditHierarchy(!editHierarchy)}
                      data-panel-toggle
                      title="Edit Hierarchy"
                      aria-pressed={editHierarchy}
                      className={`flex items-center h-[26px] px-2 rounded-md text-neutral-300 hover:bg-neutral-700/60 ${
                        editHierarchy ? "bg-neutral-700/60" : ""
                      }`}
                    >
                      <SymbolIcon name="list.bullet.indent" size={16} fallback="▤" />
                    </button>
                  ),
                  menu: [
                    {
                      type: "check" as const,
                      text: "Edit Hierarchy",
                      checked: editHierarchy,
                      action: () => setEditHierarchy(!editHierarchy),
                    },
                  ],
                },
              ]
            : []),
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
        ]}
      />
    </div>
  );
}

/** Finder's Back and Forward: plain chevrons, dimmed when there's nowhere to go. */
function HistoryButton({
  symbol,
  fallback,
  label,
  enabled,
  onClick,
}: {
  symbol: string;
  fallback: string;
  label: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      title={label}
      aria-label={label}
      className="w-7 h-[26px] flex items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-700/60 disabled:text-neutral-600 disabled:hover:bg-transparent"
    >
      <SymbolIcon name={symbol} size={15} fallback={fallback} />
    </button>
  );
}
