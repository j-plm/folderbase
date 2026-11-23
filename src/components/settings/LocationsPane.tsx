import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  LOCATIONS_CHANGED,
  deleteLocation,
  excludeFolder,
  getExcludedFolders,
  getLocations,
  getMappingNodes,
  getRules,
  includeFolder,
  ingestDirectory,
  locationAvailable,
  renameLocation,
  revealPaths,
  type Location,
} from "../../lib/commands";
import { FolderIcon } from "../../lib/fileIcons";
import { HOLDING_FOLDER } from "../../lib/fileDrag";
import { locateLocationFolder } from "../../lib/fileActions";
import { labels } from "../../lib/platform";
import { confirmAction, openLocationPanel } from "../../lib/settingsActions";
import { mappingSummary, outermost, rulesSummary } from "../../lib/settingsText";
import { dialogTextField } from "../shared/Dialog";
import AddedFolderSheet from "../shell/AddedFolderSheet";
import FolderChecklist from "../shell/FolderChecklist";
import { Button, Divider, Form, Row } from "./controls";

/**
 * Settings ▸ Locations: the locations down the left, as in the sidebar; the
 * one picked shows its settings. Each can also be changed from the location's
 * right-click in the sidebar, and both always show the same.
 */
export default function LocationsPane() {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    getLocations()
      .then((locs) => {
        setLocations(locs);
        setSelectedId((id) => (id && locs.some((l) => l.location_id === id) ? id : (locs[0]?.location_id ?? null)));
      })
      .catch(() => setLocations([]));
  }, []);

  useEffect(() => {
    load();
    const unlisten = listen(LOCATIONS_CHANGED, load);
    return () => void unlisten.then((f) => f());
  }, [load]);

  const selected = locations?.find((l) => l.location_id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <div role="listbox" aria-label="Locations" className="w-[190px] shrink-0 overflow-y-auto border-r border-neutral-700/60 bg-neutral-800 p-2 flex flex-col gap-px">
        {locations?.length === 0 && <p className="px-2 py-1 text-neutral-500">No locations</p>}
        {locations?.map((loc) => (
          <button
            key={loc.location_id}
            type="button"
            role="option"
            aria-selected={loc.location_id === selectedId}
            onClick={() => setSelectedId(loc.location_id)}
            className={`flex items-center gap-2 h-7 px-2 rounded-md text-left ${loc.location_id === selectedId ? "bg-neutral-700" : ""}`}
          >
            <FolderIcon size={16} />
            <span className="truncate">{loc.name}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto px-7 pt-6 pb-6">
        {selected ? <LocationSettings key={selected.location_id} location={selected} /> : locations && <p className="text-neutral-500">Add a location from the sidebar to see its settings here.</p>}
      </div>
    </div>
  );
}

function LocationSettings({ location }: { location: Location }) {
  const id = location.location_id;
  const [name, setName] = useState(location.name);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [mapping, setMapping] = useState("");
  const [rules, setRules] = useState("");
  const [addedFolderOpen, setAddedFolderOpen] = useState(false);

  useEffect(() => setName(location.name), [location.name]);

  // What's summed up here is read again whenever the location changes (in any window), and
  // as this window comes forward, after Map Disk Folders or Rules were edited in the main one
  useEffect(() => {
    let live = true;
    const read = () => {
      void locationAvailable(id).then((a) => live && setAvailable(a)).catch(() => {});
      void getExcludedFolders(id).then((x) => live && setExcluded(new Set(x))).catch(() => {});
      void getMappingNodes(id).then((n) => live && setMapping(mappingSummary(n))).catch(() => {});
      void getRules(location.library).then((r) => live && setRules(rulesSummary(r))).catch(() => {});
    };
    read();
    window.addEventListener("focus", read);
    return () => {
      live = false;
      window.removeEventListener("focus", read);
    };
  }, [id, location.library, location.root_path, location.added_folder]);

  const fail = (action: string) => (e: unknown) => setError(`Couldn’t ${action}: ${String(e)}`);

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === location.name) {
      setName(location.name);
      return;
    }
    setError("");
    renameLocation(id, trimmed).catch((e) => {
      setName(location.name);
      fail("rename the location")(e);
    });
  }

  async function setExcludedMany(paths: string[], exclude: boolean) {
    setError("");
    if (exclude) {
      const folders = outermost(paths);
      const names = folders.map((p) => `“${p.split(/[\\/]/).pop()}”`).join(", ");
      const ok = await confirmAction(
        folders.length === 1 ? `Leave out ${names}?` : `Leave out ${folders.length} folders?`,
        `${folders.length === 1 ? "Its" : `${names}: their`} files are taken out of “${location.name}”, with any values given to them. Nothing on disk changes.`,
        "Leave Out",
        true
      );
      if (!ok) return;
      for (const folder of folders) await excludeFolder(id, folder).catch(fail("leave the folder out"));
    } else {
      for (const folder of paths) await includeFolder(id, folder).catch(fail("include the folder"));
      // Its files are found by a refresh, started now rather than left for later
      void ingestDirectory(id).catch(fail("refresh the location"));
    }
    setExcluded(new Set(await getExcludedFolders(id).catch(() => [...excluded])));
  }

  async function remove() {
    const ok = await confirmAction(
      `Remove “${location.name}”?`,
      "Its files stay where they are on disk. The values given to them here, and its views, are removed from Folderbase.",
      "Remove",
      true
    );
    if (ok) await deleteLocation(id).catch(fail("remove the location"));
  }

  return (
    <>
      <Form>
        <Row label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setName(location.name);
                e.currentTarget.blur();
              }
            }}
            aria-label="Location name"
            className={`${dialogTextField} max-w-[280px] select-text`}
          />
        </Row>
        <Row label="Folder">
          <div className="flex items-center gap-1.5 max-w-full min-w-0">
            <FolderIcon size={16} />
            <span className="truncate select-text cursor-text" title={location.root_path}>
              {location.root_path}
            </span>
          </div>
          {!available && <p className="text-[11px] text-red-500">The folder isn’t there. It may have moved, or be on a drive that’s unplugged.</p>}
          <div className="flex gap-2">
            <Button onClick={() => void locateLocationFolder(location)}>Locate Folder…</Button>
            <Button onClick={() => void revealPaths([location.root_path])} disabled={!available}>
              {labels.reveal}
            </Button>
          </div>
        </Row>
        <Row label="Added Files folder" note="Where files dropped in from other apps are copied, inside the location.">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <FolderIcon size={16} />
              {location.added_folder ?? HOLDING_FOLDER}
            </span>
            <Button onClick={() => setAddedFolderOpen(true)}>Change…</Button>
          </div>
        </Row>
        <Divider />
        <Row label="Excluded Folders" note="Unticked folders are left out: they aren’t scanned and their files aren’t in Folderbase.">
          <div className="w-full max-w-[400px]">
            {available ? (
              <FolderChecklist rootPath={location.root_path} excluded={excluded} onSetExcluded={(paths, exclude) => void setExcludedMany(paths, exclude)} />
            ) : (
              <p className="text-neutral-500">{excluded.size === 0 ? "None" : `${excluded.size} left out`}</p>
            )}
          </div>
        </Row>
        <Row label="Map Disk Folders">
          <div className="flex items-baseline gap-3">
            <span>{mapping}</span>
            <Button onClick={() => void openLocationPanel({ panel: "disk-folders", locationId: id })}>Edit…</Button>
          </div>
        </Row>
        <Row label="Rules">
          <div className="flex items-baseline gap-3">
            <span>{rules}</span>
            <Button onClick={() => void openLocationPanel({ panel: "rules", locationId: id })}>Edit…</Button>
          </div>
        </Row>
        <Divider />
        <Row label="" note="Its files stay on disk; nothing there is moved or deleted.">
          <Button onClick={() => void remove()} destructive>
            Remove Location…
          </Button>
        </Row>
      </Form>
      {error && <p className="mt-4 text-[11px] text-red-500">{error}</p>}
      {addedFolderOpen && <AddedFolderSheet location={location} onClose={() => setAddedFolderOpen(false)} />}
    </>
  );
}
