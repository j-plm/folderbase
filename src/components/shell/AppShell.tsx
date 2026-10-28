import { useNavigation } from "../../contexts/NavigationContext";
import IconRail from "./IconRail";
import Sidebar from "./Sidebar";
import Toolbar from "./Toolbar";
import MainPane from "./MainPane";
import MasterViewEditor from "../editor/MasterViewEditor";
import { ArrangementProvider } from "../../contexts/ArrangementContext";
import { LocationViewsProvider } from "../../contexts/LocationViewsContext";
import { BrowseProvider } from "../../contexts/BrowseContext";

export default function AppShell() {
  const { masterEditorOpen, activeLocationId } = useNavigation();

  const shell = (
    <div className="relative flex h-screen bg-neutral-900 text-neutral-100">
      <IconRail />
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <Toolbar />
        <div className="flex flex-1 min-h-0">
          <MainPane />
        </div>
      </div>
      {masterEditorOpen && <MasterViewEditor />}
    </div>
  );

  return (
    <ArrangementProvider>
      {/* The location's saved views and where you are in them, shared by the sidebar, the toolbar and every view mode */}
      {activeLocationId ? (
        <LocationViewsProvider locationId={activeLocationId}>
          <BrowseProvider locationId={activeLocationId}>{shell}</BrowseProvider>
        </LocationViewsProvider>
      ) : (
        shell
      )}
    </ArrangementProvider>
  );
}
