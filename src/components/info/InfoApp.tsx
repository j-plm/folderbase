import { useCallback, useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getFilesByPaths, getLocations, infoWindowPath, type CellEdit, type Location } from "../../lib/commands";
import { useFolderSource } from "../folders/useFolderSource";
import { useEditMenu } from "../../hooks/useEditMenu";
import { setUndoTarget } from "../../lib/editMenu";
import { SymbolIcon } from "../../lib/fileIcons";
import {
  INFO_BYE,
  INFO_EDIT,
  INFO_GO,
  INFO_HELLO,
  INFO_MAIN_READY,
  INFO_STATE,
  INFO_UNDO,
  editsBefore,
  infoTitle,
  type InfoState,
} from "../../lib/info";
import { isQuickLookShortcut } from "../../lib/platform";
import { toggleQuickLook } from "../../lib/quickLook";
import {
  GeneralSection,
  Header,
  MoreInfo,
  OpenWithSection,
  PreviewSection,
  PropertiesSection,
  Section,
  TagsSection,
  useOpenSections,
} from "./InfoSections";
import type { FileRecord } from "../../types";

/*
 * Get Info (⌘I) and the Inspector (⌥⌘I), spec ▸ Get Info: a small floating
 * window laid out as Finder's Info window, its sections each with a disclosure
 * triangle. An Info window stays on its file; the Inspector follows the main
 * window's selection, summing several files up and editing them all at once.
 * Edits go to the main window (useInfoBridge), which records them so Edit ▸
 * Undo takes them back.
 */

export default function InfoApp() {
  const label = getCurrentWindow().label;
  const inspector = label === "inspector";
  const [state, setState] = useState<InfoState | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { open, toggle } = useOpenSections();
  const [locations, setLocations] = useState<Location[]>([]);

  // Typing undoes in its field; otherwise Undo and Redo take back the main window's changes
  useEditMenu();
  useEffect(() => setUndoTarget({ undo: () => void emitTo("main", INFO_UNDO, "undo"), redo: () => void emitTo("main", INFO_UNDO, "redo") }), []);

  useEffect(() => {
    const unlisten = listen<InfoState>(INFO_STATE, ({ payload }) => setState(payload));
    const hello = async () => {
      const path = inspector ? null : await infoWindowPath();
      await unlisten;
      await emitTo("main", INFO_HELLO, { label, paths: inspector ? null : path ? [path] : [] });
    };
    void hello();
    const again = listen(INFO_MAIN_READY, () => void hello());
    const bye = () => void emitTo("main", INFO_BYE, label);
    window.addEventListener("beforeunload", bye);
    void getLocations().then(setLocations).catch(() => {});
    return () => {
      window.removeEventListener("beforeunload", bye);
      void unlisten.then((f) => f());
      void again.then((f) => f());
    };
  }, [label, inspector]);

  // The files, read again on every change in the main window
  const pathsKey = state?.paths.join("\n") ?? "";
  useEffect(() => {
    if (!state) return;
    let current = true;
    void getFilesByPaths(state.paths)
      .then((f) => current && (setFiles(f), setLoaded(true)))
      .catch(() => current && setLoaded(true));
    return () => {
      current = false;
    };
    // `pathsKey` and the revision stand for what to read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey, state?.revision]);

  // Properties belong to a location: shown when every file is in the same one
  const locationId = files.length > 0 && files.every((f) => f.location_id === files[0].location_id) ? (files[0].location_id ?? null) : null;
  const source = useFolderSource(locationId);
  const { reload } = source;
  useEffect(() => {
    void reload().catch(() => {});
  }, [state?.revision, reload]);

  useEffect(() => {
    void getCurrentWindow().setTitle(inspector ? (files.length > 0 ? `${infoTitle(files)} Info` : "Inspector") : `${infoTitle(files)} Info`);
  }, [files, inspector]);

  // Space previews the file, as everywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (isQuickLookShortcut(e) && files.length > 0) {
        e.preventDefault();
        void toggleQuickLook({ paths: files.map((f) => f.file_path), index: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files]);

  /** Shown at once, then written by the main window into the location's history. */
  const edit = useCallback(
    (edits: CellEdit[], what: string) => {
      if (!locationId || edits.length === 0) return;
      const before = editsBefore(edits, files);
      setFiles((prev) =>
        prev.map((f) => {
          const mine = edits.filter((e) => e.file_id === f.file_id);
          if (mine.length === 0) return f;
          const metadata = { ...(f.metadata ?? {}) };
          for (const e of mine) {
            if (e.value == null) delete metadata[e.key];
            else metadata[e.key] = e.value;
          }
          return { ...f, metadata };
        })
      );
      void emitTo("main", INFO_EDIT, { locationId, label: what, edits, before });
    },
    [locationId, files]
  );

  if (!loaded) return <div className="h-screen bg-neutral-900" />;
  if (files.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-neutral-900 text-neutral-500 select-none">
        {inspector ? "No Selection" : "This item is no longer in Folderbase."}
      </div>
    );
  }

  const single = files.length === 1 ? files[0] : null;
  const location = locationId ? locations.find((l) => l.location_id === locationId) ?? null : null;

  return (
    <div className="h-screen overflow-y-auto bg-neutral-900 text-neutral-100 text-body select-none">
      <Header files={files} />
      <Section id="tags" title="Tags" open={open} toggle={toggle}>
        <TagsSection files={files} source={source} onEdit={edit} />
      </Section>
      <Section id="general" title="General" open={open} toggle={toggle}>
        <GeneralSection files={files} location={location} />
      </Section>
      {state && single && state.locationId === single.location_id && (
        <Section id="folders" title="Folders" open={open} toggle={toggle}>
          <FoldersSection file={single} state={state} />
        </Section>
      )}
      {locationId && (
        <Section id="properties" title="Properties" open={open} toggle={toggle}>
          <PropertiesSection files={files} source={source} onEdit={edit} />
        </Section>
      )}
      <MoreInfo files={files} open={open} toggle={toggle} />
      <Section id="openWith" title="Open With" open={open} toggle={toggle}>
        <OpenWithSection files={files} />
      </Section>
      {single && (
        <Section id="preview" title="Preview" open={open} toggle={toggle}>
          <PreviewSection file={single} />
        </Section>
      )}
    </div>
  );
}

function FoldersSection({ file, state }: { file: FileRecord; state: InfoState }) {
  const folders = state.folders[file.file_path] ?? [];
  const view = state.viewName ? `“${state.viewName}”` : "this view";
  if (folders.length === 0) {
    return <span className="text-neutral-500">Not in a folder of {view}.</span>;
  }
  return (
    <>
      <span className="text-[11px] text-neutral-400">In {view}:</span>
      {folders.map((f) => (
        <button
          key={JSON.stringify(f.path)}
          type="button"
          onClick={() => state.locationId && void emitTo("main", INFO_GO, { locationId: state.locationId, path: f.path })}
          className="flex items-center gap-1.5 text-left rounded-[4px] px-1 -mx-1 hover:bg-neutral-500/10"
        >
          <SymbolIcon name="folder" size={13} fallback="▤" className="text-blue-500" />
          <span className="min-w-0 truncate">{f.labels.join(" › ")}</span>
        </button>
      ))}
    </>
  );
}
