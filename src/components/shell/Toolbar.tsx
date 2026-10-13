import { useNavigation } from "../../contexts/NavigationContext";
import Breadcrumb from "./Breadcrumb";
import type { ViewMode } from "../../types/navigation";

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "tiles", label: "Tiles" },
  { mode: "list", label: "List" },
  { mode: "columns", label: "Columns" },
  { mode: "database", label: "Database" },
];

export default function Toolbar() {
  const { viewMode, setViewMode } = useNavigation();

  return (
    <div className="flex items-center gap-3 px-3 h-11 border-b border-neutral-700/60 bg-neutral-800/50 shrink-0">
      <div className="flex-1 min-w-0">
        <Breadcrumb viewName="Folderbase" />
      </div>

      <div className="flex items-center gap-px bg-neutral-700/50 rounded-md p-0.5 shrink-0">
        {VIEW_MODES.map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              viewMode === mode
                ? "bg-neutral-600 text-neutral-100"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
