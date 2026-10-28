import { useMemo } from "react";
import type React from "react";
import { FolderIcon } from "../../lib/fileIcons";
import { twoLineLabel } from "../../lib/tileLabel";
import { measureText, uiFont } from "../../lib/textMeasure";
import { FolderNote, type FolderNoteText, type LevelLayoutProps, type LevelNode } from "./levels";

// Same cell metrics as TilesView (Finder icon view): 64pt icons, 106pt cells.
const TILE_WIDTH = 106;
const COLUMN_GAP = 9;
const LABEL_WIDTH = TILE_WIDTH - 8;

function FolderTile({
  node,
  note,
  isSelected,
  isDimmed,
  labelFont,
  onSelect,
  onContextMenu,
}: {
  node: LevelNode;
  note: FolderNoteText | undefined;
  isSelected: boolean;
  isDimmed: boolean;
  labelFont: string;
  onSelect: (shiftKey: boolean) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={(e) => onSelect(e.shiftKey)}
      onContextMenu={onContextMenu}
      title={node.folder_name}
      className={`flex flex-col items-center gap-1 cursor-default select-none ${isDimmed ? "opacity-50" : ""}`}
      style={{ width: TILE_WIDTH }}
    >
      <div
        className={`flex items-center justify-center w-[76px] h-[76px] rounded-md ${
          isSelected ? "bg-neutral-700/70" : ""
        }`}
      >
        <FolderIcon size={64} />
      </div>
      <span
        className={`max-w-full px-1 rounded text-xs text-center whitespace-nowrap leading-[15px] ${
          isSelected ? "bg-blue-600 text-white" : "text-neutral-100"
        }`}
      >
        {twoLineLabel(node.folder_name, LABEL_WIDTH, (t) => measureText(t, labelFont)).map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))}
      </span>
      <FolderNote note={note} className="max-w-full -mt-0.5 text-neutral-100" />
    </div>
  );
}

/** Levels as tiles: one section per level, like a group in the tiles view. */
export default function LevelTiles<N extends LevelNode>({
  levels,
  heading,
  caption,
  folderName,
  onToggle,
  onFolderMenu,
  note,
  dimmed,
  emptyGroup,
}: LevelLayoutProps<N>) {
  const labelFont = useMemo(() => uiFont(12), []);

  return (
    <div className="h-full overflow-y-auto">
      {levels.map((level, levelIndex) => (
        <section key={levelIndex} className={levelIndex > 0 ? "border-t border-neutral-700/60" : ""}>
          <div className="flex items-center gap-3 px-5 pt-2.5">
            {heading(levelIndex, "tiles")}
            <span className="shrink-0 text-[11px] text-neutral-500">{caption(levelIndex)}</span>
          </div>
          {level.groups.map((group) => (
            <div key={group.parentPath}>
              {level.groups.length > 1 && (
                <h3 className="px-5 pt-2 text-[11px] font-medium text-neutral-500">{folderName(group.parentPath)}</h3>
              )}
              {group.nodes.length === 0 && emptyGroup ? (
                <div className="px-5 py-3 text-[12px] text-neutral-500">{emptyGroup(group)}</div>
              ) : (
                <div
                  className="grid justify-start gap-y-3 p-4"
                  style={{ gridTemplateColumns: `repeat(auto-fill, ${TILE_WIDTH}px)`, columnGap: COLUMN_GAP }}
                >
                  {group.nodes.map((node) => (
                    <FolderTile
                      key={node.folder_path}
                      node={node}
                      note={note(node)}
                      isSelected={level.selected.includes(node.folder_path)}
                      isDimmed={dimmed(node)}
                      onContextMenu={(e) => onFolderMenu(e, levelIndex, node)}
                      labelFont={labelFont}
                      onSelect={(shiftKey) => onToggle(levelIndex, node.folder_path, shiftKey)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
