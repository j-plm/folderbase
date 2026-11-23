import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { APPEARANCE_CHANGED, getAppearance, setAppearance, type Appearance, type FirstViewMode } from "../../lib/commands";
import { appSettings } from "../../lib/appSettings";
import { useAppSettings } from "../../hooks/useAppSettings";
import { confirmAction, refreshAllLocations } from "../../lib/settingsActions";
import { Checkbox, Form, PaneFooter, PopUp, Row, type Choice } from "./controls";

const APPEARANCES: Choice<Appearance>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Use System Setting" },
];

// Icons is TilesView in code
const VIEW_MODES: Choice<FirstViewMode>[] = [
  { value: "database", label: "Database" },
  { value: "tiles", label: "Icons" },
  { value: "list", label: "List" },
  { value: "columns", label: "Columns" },
];

const LAUNCH: Choice<"last" | "first">[] = [
  { value: "last", label: "The last location and view" },
  { value: "first", label: "The first location" },
];

const MISSING: Choice<"periodic" | "focus">[] = [
  { value: "periodic", label: "Every 30 seconds and when the window comes forward" },
  { value: "focus", label: "Only when the window comes forward" },
];

/** The appearance chosen, kept in step with View ▸ Appearance. */
function useAppearance(): Appearance {
  const [appearance, setLocal] = useState<Appearance>("system");
  useEffect(() => {
    void getAppearance().then(setLocal).catch(() => {});
    const unlisten = listen<Appearance>(APPEARANCE_CHANGED, (e) => setLocal(e.payload));
    return () => void unlisten.then((f) => f());
  }, []);
  return appearance;
}

/**
 * Turns Show hidden files on or off, after asking: every location is refreshed
 * so they're indexed or taken out, and taking them out drops their values.
 */
async function setShowHidden(on: boolean): Promise<boolean> {
  const confirmed = on
    ? await confirmAction(
        "Show hidden files?",
        "Files and folders whose names start with “.” are added to every location. Each location is refreshed to find them, which can take a while.",
        "Show Hidden Files"
      )
    : await confirmAction(
        "Hide hidden files?",
        "Files and folders whose names start with “.” are taken out of every location, with any values given to them. Nothing on disk changes. Each location is refreshed.",
        "Hide Hidden Files",
        true
      );
  if (!confirmed) return false;
  await appSettings.update({ show_hidden_files: on });
  void refreshAllLocations();
  return true;
}

export default function GeneralPane() {
  const settings = useAppSettings();
  const appearance = useAppearance();

  async function restore() {
    if (settings.show_hidden_files && !(await setShowHidden(false))) return;
    await setAppearance("system");
    await appSettings.update({ first_view_mode: null, on_launch: null, missing_check: null });
  }

  return (
    <>
      <Form>
        <Row label="Appearance">
          <PopUp value={appearance} choices={APPEARANCES} onChange={(a) => void setAppearance(a)} />
        </Row>
        <Row label="New locations open in" note="After that, each location opens in the view mode it was left in.">
          <PopUp value={settings.first_view_mode} choices={VIEW_MODES} onChange={(m) => void appSettings.update({ first_view_mode: m })} />
        </Row>
        <Row label="On launch, open">
          <PopUp value={settings.on_launch} choices={LAUNCH} onChange={(v) => void appSettings.update({ on_launch: v })} />
        </Row>
        <Row label="Hidden files" note="Files and folders whose names start with “.”. Finder’s .DS_Store files are always left out.">
          <Checkbox checked={settings.show_hidden_files} onChange={(on) => void setShowHidden(on)}>
            Show hidden files
          </Checkbox>
        </Row>
        <Row label="Check for missing folders" note="A location whose folder has moved, or is on a drive that’s unplugged, shows as missing in the sidebar.">
          <PopUp value={settings.missing_check} choices={MISSING} onChange={(v) => void appSettings.update({ missing_check: v })} />
        </Row>
      </Form>
      <PaneFooter onRestore={() => void restore()} />
    </>
  );
}
