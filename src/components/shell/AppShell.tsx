import { useNavigation } from "../../contexts/NavigationContext";
import IconRail from "./IconRail";
import Sidebar from "./Sidebar";
import Toolbar from "./Toolbar";
import MainPane from "./MainPane";
import LocalViewEditor from "../editor/LocalViewEditor";
import MasterViewEditor from "../editor/MasterViewEditor";
import { ArrangementProvider } from "../../contexts/ArrangementContext";

export default function AppShell() {
  const { editStructure, masterEditorOpen } = useNavigation();

  return (
    <ArrangementProvider>
      <div className="relative flex h-screen bg-neutral-900 text-neutral-100">
        <IconRail />
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <Toolbar />
          <div className="flex flex-1 min-h-0">
            <MainPane />
            {editStructure && <LocalViewEditor />}
          </div>
        </div>
        {masterEditorOpen && <MasterViewEditor />}
      </div>
    </ArrangementProvider>
  );
}
