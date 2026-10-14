import { useNavigation } from "../../contexts/NavigationContext";
import { useLocationFiles } from "../../hooks/useLocationFiles";
import TilesView from "../views/TilesView";
import ListView from "../views/ListView";
import ColumnsView from "../views/ColumnsView";
import LocationDatabaseView from "../views/LocationDatabaseView";

export default function MainPane() {
  const { activeLocationId, viewMode } = useNavigation();
  const { files, loading, refresh } = useLocationFiles(activeLocationId);

  if (!activeLocationId) {
    return (
      <div className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
        Map a location to get started.
      </div>
    );
  }

  if (loading && files.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto flex flex-col">
      {viewMode === "tiles" && <TilesView files={files} />}
      {viewMode === "list" && <ListView files={files} />}
      {viewMode === "columns" && <ColumnsView files={files} />}
      {viewMode === "database" && (
        <LocationDatabaseView files={files} locationId={activeLocationId} onMappingChanged={refresh} />
      )}
    </div>
  );
}
