import { useNavigation } from "../../contexts/NavigationContext";
import { useLocationFiles } from "../../hooks/useLocationFiles";
import TilesView from "../views/TilesView";
import ListView from "../views/ListView";
import ColumnsView from "../views/ColumnsView";
import LocationDatabaseView from "../views/LocationDatabaseView";
import PathMappingPanel from "../mapping/PathMappingPanel";

// Content starts past the floating sidebar. Columns view applies the inset inside its own
// horizontal scroller, so earlier columns slide under the sidebar as in Finder.
const INSET = { paddingLeft: "var(--sidebar-inset)" };

export default function MainPane() {
  const { activeLocationId, viewMode, structureLocationId, closeStructureMapping } = useNavigation();
  const { files, loading, refresh } = useLocationFiles(activeLocationId);

  if (!activeLocationId) {
    return (
      <div style={INSET} className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
        Add a location to get started.
      </div>
    );
  }

  if (loading && files.length === 0) {
    return (
      <div style={INSET} className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-w-0 flex flex-col">
      <div style={viewMode === "columns" ? undefined : INSET} className="flex-1 overflow-auto flex flex-col">
        {viewMode === "tiles" && <TilesView files={files} />}
        {viewMode === "list" && <ListView files={files} />}
        {viewMode === "columns" && <ColumnsView files={files} />}
        {viewMode === "database" && (
          <LocationDatabaseView files={files} locationId={activeLocationId} onChanged={refresh} />
        )}
      </div>
      {structureLocationId === activeLocationId && (
        <PathMappingPanel
          locationId={activeLocationId}
          onClose={() => {
            closeStructureMapping();
            refresh();
          }}
        />
      )}
    </div>
  );
}
