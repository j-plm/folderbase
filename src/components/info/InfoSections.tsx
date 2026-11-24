import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  appsForPaths,
  createProperty,
  pickApplication,
  revealPaths,
  type CellEdit,
  type Location,
  type OpenWithApp,
} from "../../lib/commands";
import type { useFolderSource } from "../folders/useFolderSource";
import { chooseDefaultApp } from "../../lib/fileActions";
import { FileIcon, SymbolIcon } from "../../lib/fileIcons";
import { impliedByFile, valueReader } from "../../lib/fileValues";
import { fileExtension, fileName } from "../../lib/fileColumns";
import { formatFinderDate, formatLongDate, kindLabel } from "../../lib/arrange";
import { infoTitle, mediaRows, sameText, selectionSummary, sizeWithBytes } from "../../lib/info";
import { EXTRACTED_KEYS, TYPE_OPTIONS, parseConfig } from "../../lib/propertyTypes";
import { labels, platform } from "../../lib/platform";
import { toggleQuickLook } from "../../lib/quickLook";
import { thumbnailUrl } from "../../lib/thumbnails";
import { PropertyRow, PropertyValue, ReadOnlyRow } from "./PropertyRows";
import type { FileRecord, ValueType } from "../../types";

/*
 * The sections of Get Info and the Inspector (spec ▸ Get Info), each its own
 * component taking the files shown, so the Preview pane and Columns' preview
 * column show the same ones. Which are open is kept for all of them.
 */

export type SectionId = "tags" | "general" | "folders" | "properties" | "more" | "openWith" | "preview";
const OPEN_KEY = "info-sections";
const DEFAULT_OPEN: SectionId[] = ["tags", "general", "folders", "properties", "openWith", "preview"];

export function loadOpen(): Set<SectionId> {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
    if (Array.isArray(saved)) return new Set(saved as SectionId[]);
  } catch {
    // fall through
  }
  return new Set(DEFAULT_OPEN);
}

/** Which sections are open, kept for every Info window, the Inspector and the Preview pane. */
export function useOpenSections() {
  const [open, setOpen] = useState(loadOpen);
  const toggle = useCallback(
    (id: SectionId) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
        return next;
      }),
    []
  );
  return { open, toggle };
}

// ── Layout ───────────────────────────────────────────────────────────────────

export function Section({ id, title, open, toggle, children }: { id: SectionId; title: string; open: Set<SectionId>; toggle: (id: SectionId) => void; children: ReactNode }) {
  const shown = open.has(id);
  return (
    <section className="border-t border-neutral-700/60">
      <button type="button" onClick={() => toggle(id)} className="flex items-center gap-1 w-full px-2 h-[24px] font-semibold text-left">
        <SymbolIcon name={shown ? "chevron.down" : "chevron.right"} size={9} fallback={shown ? "▾" : "▸"} className="text-neutral-400" />
        {title}:
      </button>
      {shown && <div className="px-3 pb-2.5 flex flex-col gap-1">{children}</div>}
    </section>
  );
}

export function Header({ files }: { files: FileRecord[] }) {
  const single = files.length === 1 ? files[0] : null;
  return (
    <div className="flex items-center gap-2.5 px-3 py-3">
      {single ? (
        <FileIcon path={single.file_path} mimeType={single.file_type} size={40} />
      ) : (
        <SymbolIcon name="doc.on.doc" size={34} fallback="▢" className="text-neutral-400" />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate select-text" title={single?.file_path}>
          {single ? fileName(single.file_path) : infoTitle(files)}
        </div>
        <div className="text-[11px] text-neutral-400 flex justify-between gap-2">
          <span>{single ? sizeWithBytes(single.file_size).split(" (")[0] : selectionSummary(files)}</span>
          {single && <span className="truncate">Modified: {formatFinderDate(single.modified_at ?? single.timestamp)}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

export type Source = ReturnType<typeof useFolderSource>;
export type OnEdit = (edits: CellEdit[], label: string) => void;

/** The built-in Tags property, as Finder's Tags field. */
export function tagsProperty(source: Source) {
  return source.properties.map((n) => source.propertyOf(n)).find((p) => p && parseConfig(p).system === "tags") ?? null;
}

export function TagsSection({ files, source, onEdit }: { files: FileRecord[]; source: Source; onEdit: OnEdit }) {
  const tags = tagsProperty(source);
  if (!tags) return <span className="text-neutral-500">No Tags property in this location.</span>;
  return (
    <PropertyValue
      name={tags.name}
      type="array"
      config={{}}
      files={files}
      options={source.valuesOf(tags.name)}
      onEdit={onEdit}
      placeholder="Add Tags"
    />
  );
}

export function GeneralSection({ files, location }: { files: FileRecord[]; location: Location | null }) {
  const single = files.length === 1 ? files[0] : null;
  if (!single) {
    return (
      <>
        <ReadOnlyRow label="Kind" text={sameText(files.map((f) => kindLabel(f)))} />
        <ReadOnlyRow label="Size" text={selectionSummary(files).split(", ")[1]} />
        {location && <ReadOnlyRow label="Location" text={location.name} />}
      </>
    );
  }
  const where = single.file_path.replace(/[\\/][^\\/]*$/, "");
  return (
    <>
      <ReadOnlyRow label="Kind" text={kindLabel(single)} />
      <ReadOnlyRow label="Size" text={sizeWithBytes(single.file_size)} />
      <div className="grid grid-cols-[88px_1fr] items-baseline gap-x-2">
        <span className="text-right text-neutral-400">Where:</span>
        <button
          type="button"
          title={labels.reveal}
          onClick={() => void revealPaths([single.file_path]).catch(() => {})}
          className="text-left break-all hover:underline"
        >
          {where}
        </button>
      </div>
      <ReadOnlyRow label="Created" text={formatLongDate(single.timestamp)} />
      <ReadOnlyRow label="Modified" text={formatLongDate(single.modified_at ?? single.timestamp)} />
      {location && <ReadOnlyRow label="Location" text={location.name} />}
    </>
  );
}

export function PropertiesSection({ files, source, onEdit }: { files: FileRecord[]; source: Source; onEdit: OnEdit }) {
  const { typeOf, scopes, properties, propertyOf, valuesOf, library } = source;
  const reader = useMemo(
    () => valueReader({ typeOf, scopes, implied: impliedByFile(files, scopes, (p) => typeOf(p) === "array") }),
    [files, typeOf, scopes]
  );
  const tags = tagsProperty(source);
  // Custom properties only (media ones are under More Info, Tags has its own section); a conditional one where it applies
  const shown = properties.filter(
    (name) => !EXTRACTED_KEYS.has(name) && name !== tags?.name && files.every((f) => reader.appliesTo(f, name))
  );
  return (
    <>
      {shown.map((name) => (
        <PropertyRow
          key={name}
          name={name}
          type={typeOf(name)}
          config={parseConfig(propertyOf(name))}
          files={files}
          options={valuesOf(name)}
          onEdit={onEdit}
        />
      ))}
      {shown.length === 0 && <span className="text-neutral-500">No properties yet.</span>}
      <AddProperty
        taken={properties}
        onAdd={async (name, type) => {
          await createProperty(name, library, type);
          await source.reload();
        }}
      />
    </>
  );
}

function AddProperty({ taken, onAdd }: { taken: string[]; onAdd: (name: string, type: ValueType) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ValueType>("free_text");
  const [error, setError] = useState<string | null>(null);
  if (!adding) {
    return (
      <button type="button" onClick={() => setAdding(true)} className="self-start mt-1 text-blue-500 hover:underline">
        Add Property…
      </button>
    );
  }
  const submit = async () => {
    const n = name.trim();
    if (!n) return setAdding(false);
    if (taken.some((t) => t.toLowerCase() === n.toLowerCase())) return setError(`There’s already a property called “${n}”.`);
    try {
      await onAdd(n, type);
      setAdding(false);
      setName("");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="flex flex-col gap-1 mt-1">
      <div className="flex gap-1">
        <input
          autoFocus
          value={name}
          placeholder="Property name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") setAdding(false);
          }}
          className="flex-1 min-w-0 h-[22px] px-1.5 rounded-[5px] bg-neutral-800 ring-1 ring-neutral-700 focus:ring-2 focus:ring-blue-500/60 outline-none"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ValueType)}
          className="h-[22px] rounded-[5px] bg-neutral-700/70 px-1 outline-none"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}

export function MoreInfo({ files, open, toggle }: { files: FileRecord[]; open: Set<SectionId>; toggle: (id: SectionId) => void }) {
  const rows = mediaRows(files);
  if (rows.length === 0) return null;
  return (
    <Section id="more" title="More Info" open={open} toggle={toggle}>
      {rows.map((r) => (
        <ReadOnlyRow key={r.label} label={r.label} text={r.text} />
      ))}
    </Section>
  );
}

export function OpenWithSection({ files }: { files: FileRecord[] }) {
  const paths = useMemo(() => files.map((f) => f.file_path), [files]);
  const pathsKey = paths.join("\n");
  const [apps, setApps] = useState<OpenWithApp[] | null>(null);
  const load = useCallback(() => void appsForPaths(paths).then(setApps).catch(() => setApps([])), [paths]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [pathsKey]);
  if (apps === null) return null;
  if (platform !== "macos") return <span className="text-neutral-500">Changing the app comes with Windows and Linux support.</span>;

  const current = apps.find((a) => a.is_default) ?? null;
  const kinds = [...new Set(paths.map((p) => fileExtension(p)))];
  const kindText = kinds.length === 1 && kinds[0] ? `“.${kinds[0]}”` : "these kinds";

  const choose = async (app: string) => {
    if (await chooseDefaultApp(paths, app, false)) load();
  };
  const other = async () => {
    const app = await pickApplication();
    if (app) await choose(app);
  };
  const changeAll = async () => {
    if (!current) return;
    const ok = await ask(`This change will apply to all documents with extension ${kindText}.`, {
      title: `Are you sure you want to change all similar documents to open with the application “${current.name}”?`,
      okLabel: "Continue",
      cancelLabel: "Cancel",
    });
    if (ok && (await chooseDefaultApp(paths, current.path, true))) load();
  };

  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          void import("../../lib/nativeMenu").then(({ showContextMenu }) =>
            showContextMenu(
              [
                ...apps.map((a) => ({
                  type: "check" as const,
                  text: a.is_default ? `${a.name} (default)` : a.name,
                  checked: a.is_default,
                  key: a.path,
                  action: () => void (a.is_default ? undefined : choose(a.path)),
                })),
                { type: "separator" as const },
                { type: "item" as const, text: "Other…", action: () => void other() },
              ],
              { alignKey: current?.path, event: { clientX: rect.left, clientY: rect.top + rect.height / 2 } }
            )
          );
        }}
        className="inline-flex items-center gap-1.5 h-[22px] pl-2 pr-1 max-w-full self-start rounded-[6px] bg-neutral-700/70 active:bg-neutral-700"
      >
        <span className="truncate">{current ? current.name : files.length > 1 ? "Mixed" : "No App Set"}</span>
        <SymbolIcon name="chevron.up.chevron.down" size={9} fallback="⌃" className="ml-1" />
      </button>
      <p className="text-[11px] leading-snug text-neutral-400">
        Use this application to open all documents like {files.length === 1 ? "this one" : "these"}.
      </p>
      <button
        type="button"
        disabled={!current}
        onClick={() => void changeAll()}
        className="self-start h-[22px] px-2.5 rounded-[6px] bg-neutral-700/70 active:bg-neutral-700 disabled:opacity-50"
      >
        Change All…
      </button>
    </>
  );
}

export function PreviewSection({ file }: { file: FileRecord }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    // Online-only files aren't downloaded just to show a picture of them
    if (file.online_only) setSrc(null);
    else void thumbnailUrl(file.file_path, 240).then((url) => current && setSrc(url));
    return () => {
      current = false;
    };
  }, [file.file_path, file.online_only]);
  return (
    <button
      type="button"
      title="Quick Look (Space)"
      onClick={() => void toggleQuickLook({ paths: [file.file_path], index: 0 })}
      className="flex justify-center py-1"
    >
      {src ? (
        <img src={src} alt="" draggable={false} className="max-w-full max-h-[240px] object-contain rounded-[3px] shadow-sm" />
      ) : (
        <FileIcon path={file.file_path} mimeType={file.file_type} size={128} />
      )}
    </button>
  );
}
