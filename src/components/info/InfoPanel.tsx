import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useBrowse } from "../../contexts/BrowseContext";
import { useInfoEdit } from "../../hooks/useInfoEdit";
import { revealPaths, type CellEdit } from "../../lib/commands";
import { formatFinderSize, kindLabel } from "../../lib/arrange";
import { fileName } from "../../lib/fileColumns";
import { editsBefore, informationRows, selectionSummary, showMore, type InfoRow } from "../../lib/info";
import { labels } from "../../lib/platform";
import { useFolderSource } from "../folders/useFolderSource";
import PreviewStage from "../views/shared/PreviewStage";
import { PreviewSection, PropertiesSection, TagsSection } from "./InfoSections";
import type { FileRecord } from "../../types";

interface Props {
  files: FileRecord[];
  /**
   * The picture at the top for one file: the live preview (Columns' preview
   * column, the Preview pane), a still thumbnail (the pane in Gallery, whose
   * large preview holds the one live view), or none.
   */
  preview: "live" | "still" | "none";
  /** Mark the picture as the file's icon, so Quick Look zooms out of it (Columns). */
  iconOf?: boolean;
}

/**
 * Finder's preview, shared by Columns' preview column, the Preview pane and
 * Gallery (spec ▸ Preview Pane): the preview, the name with Kind and size,
 * Information (with Show More), Tags, then Properties, editable as in Get Info.
 * Several files are summed up, with the values they share editable for all.
 * Edits go into the open location's history, so Edit ▸ Undo takes them back.
 */
export default function InfoPanel({ files, preview, iconOf = false }: Props) {
  const browse = useBrowse();
  const locationId = files.length > 0 && files.every((f) => f.location_id === files[0].location_id) ? (files[0].location_id ?? null) : null;
  const source = useFolderSource(locationId);
  const { reload } = source;
  // New values may have been registered with any change to the files
  useEffect(() => {
    void reload().catch(() => {});
  }, [browse?.files, reload]);

  const apply = useInfoEdit();
  const edit = useCallback(
    (edits: CellEdit[], label: string) => {
      if (!locationId || edits.length === 0) return;
      void apply({ locationId, label, edits, before: editsBefore(edits, files) });
    },
    [apply, locationId, files]
  );

  const single = files.length === 1 ? files[0] : null;

  return (
    <div className="flex flex-col select-none">
      {single && preview === "live" && <PreviewStage file={single} live iconOf={iconOf} />}
      {single && preview === "still" && <PreviewSection file={single} />}
      <div className={single && preview !== "none" ? "mt-6" : ""}>
        <p className="text-[15px] font-semibold text-neutral-100 break-words select-text">
          {single ? fileName(single.file_path) : `${files.length.toLocaleString()} items`}
        </p>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          {single ? `${kindLabel(single)} - ${formatFinderSize(single.file_size)}` : selectionSummary(files).split(", ")[1]}
        </p>
        <Information files={files} />
        <Heading>Tags</Heading>
        <div className="flex flex-col gap-1 text-[13px]">
          <TagsSection files={files} source={source} onEdit={edit} />
        </div>
        {locationId && (
          <>
            <Heading>Properties</Heading>
            <div className="flex flex-col gap-1 text-xs">
              <PropertiesSection files={files} source={source} onEdit={edit} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <p className="mt-4 mb-1 text-[15px] font-semibold text-neutral-100">{children}</p>;
}

function Information({ files }: { files: FileRecord[] }) {
  const [expanded, setExpanded] = useState(false);
  const single = files.length === 1 ? files[0] : null;
  const rows: (InfoRow & { reveal?: string })[] = informationRows(files);
  // Where comes after the dates, for one file: click it to show the file in Finder
  if (single) rows.splice(2, 0, { label: "Where", text: single.file_path.replace(/[\\/][^\\/]*$/, ""), reveal: single.file_path });
  const { shown, toggle } = showMore(rows, expanded);
  return (
    <>
      <div className="flex items-baseline justify-between">
        <Heading>Information</Heading>
        {toggle && (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="text-xs text-blue-500 hover:underline">
            {expanded ? "Show Less" : "Show More"}
          </button>
        )}
      </div>
      <dl className="text-xs">
        {shown.map((row, i) => (
          <div key={row.label} className={`flex justify-between gap-3 py-1.5 ${i > 0 ? "border-t border-neutral-700/60" : ""}`}>
            <dt className="shrink-0 text-neutral-500">{row.label}</dt>
            <dd className="min-w-0 font-semibold text-neutral-100 text-right break-words">
              {row.reveal ? (
                <button
                  type="button"
                  title={labels.reveal}
                  onClick={() => void revealPaths([row.reveal!]).catch(() => {})}
                  className="text-right break-all hover:underline"
                >
                  {row.text}
                </button>
              ) : (
                row.text
              )}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
