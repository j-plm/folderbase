import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FileIcon, isImageMime } from "../../lib/fileIcons";
import { openPath } from "../../lib/commands";
import type { FileRecord } from "../../types";
import { fileName, groupFiles } from "../../lib/arrange";
import { showContextMenu } from "../../lib/nativeMenu";
import { arrangementMenu, useArrangement } from "../../contexts/ArrangementContext";
import { twoLineLabel } from "../../lib/tileLabel";
import { measureText, uiFont } from "../../lib/textMeasure";

interface Props {
  files: FileRecord[];
}

// Finder icon view (macOS 26): 64pt icons, 106pt cells, 9pt column gap.
const TILE_WIDTH = 106;
const COLUMN_GAP = 9;
/** Label text width: cell minus the selection pill's side padding. */
const LABEL_WIDTH = TILE_WIDTH - 8;

export default function TilesView({ files }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const arrangementCtx = useArrangement();
  const labelFont = useMemo(() => uiFont(12), []);
  const groups = useMemo(
    () => groupFiles(files, arrangementCtx.arrangement),
    [files, arrangementCtx.arrangement]
  );

  async function handleOpen(filePath: string) {
    try {
      await openPath(filePath);
    } catch {
      // ignore
    }
  }

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
        No files
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-auto"
      onClick={() => setSelectedId(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        showContextMenu(arrangementMenu(arrangementCtx));
      }}
    >
      {groups.map((group, groupIndex) => (
        <section
          key={group.label}
          className={groupIndex > 0 ? "border-t border-neutral-700/60" : ""}
        >
          {group.label && (
            <h2 className="px-5 pt-2.5 text-[15px] font-semibold text-neutral-400">
              {group.label}
            </h2>
          )}
          {/* Fixed-size cells and gaps: the window width only changes how many fit per row */}
          <div
            className="grid justify-start gap-y-3 p-4"
            style={{ gridTemplateColumns: `repeat(auto-fill, ${TILE_WIDTH}px)`, columnGap: COLUMN_GAP }}
          >
            {group.files.map((file) => {
              const name = fileName(file.file_path);
              const isSelected = file.file_id === selectedId;
              return (
                <div
                  key={file.file_id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(file.file_id);
                  }}
                  onDoubleClick={() => handleOpen(file.file_path)}
                  className="flex flex-col items-center gap-1 cursor-default select-none"
                  style={{ width: TILE_WIDTH }}
                >
                  <div
                    className={`flex items-center justify-center w-[76px] h-[76px] rounded-md ${
                      isSelected ? "bg-neutral-700/70" : ""
                    }`}
                  >
                    {isImageMime(file.file_type) ? (
                      <img
                        src={convertFileSrc(file.file_path)}
                        alt={name}
                        loading="lazy"
                        draggable={false}
                        className="max-w-16 max-h-16 object-contain shadow-sm"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    ) : (
                      <FileIcon path={file.file_path} mimeType={file.file_type} size={64} />
                    )}
                  </div>
                  <span
                    className={`max-w-full px-1 rounded text-xs text-center whitespace-nowrap leading-[15px] ${
                      isSelected ? "bg-blue-600 text-white" : "text-neutral-100"
                    }`}
                    title={name}
                  >
                    {twoLineLabel(name, LABEL_WIDTH, (t) => measureText(t, labelFont)).map((line, i) => (
                      <span key={i} className="block">
                        {line}
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
