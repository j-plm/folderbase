import { useEffect, useMemo, useRef } from "react";
import type { FolderTreeNode } from "../../lib/commands";
import { FolderIcon } from "../../lib/fileIcons";
import { twoLineLabel } from "../../lib/tileLabel";
import { measureText, uiFont } from "../../lib/textMeasure";
import {
  InheritNameButton,
  LevelNameInput,
  MappedLabel,
  levelCaption,
  levelKey,
  levelName,
  levelPlaceholder,
  levelTargets,
  type LevelRendererProps,
} from "./levels";

// Same cell metrics as TilesView (Finder icon view): 64pt icons, 106pt cells.
const TILE_WIDTH = 106;
const COLUMN_GAP = 9;
const LABEL_WIDTH = TILE_WIDTH - 8;

function FolderTile({
  node,
  label,
  isSelected,
  labelFont,
  onSelect,
  onDrillIn,
}: {
  node: FolderTreeNode;
  label: string | undefined;
  isSelected: boolean;
  labelFont: string;
  onSelect: () => void;
  onDrillIn: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Delay the single-click toggle so a double-click drills in without
  // expanding and collapsing the level below first.
  function handleClick() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    } else {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onSelect();
      }, 220);
    }
  }

  function handleDoubleClick() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    onDrillIn();
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={node.folder_name}
      className="flex flex-col items-center gap-1 cursor-default select-none"
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
      <MappedLabel name={label} className="max-w-full -mt-0.5 text-neutral-100" />
    </div>
  );
}

/** Tile mode of the mapping editor: one section per level, like a group in the tiles view. */
export default function MappingTiles({
  levels,
  labels,
  savedLevel,
  folderName,
  onToggle,
  onCommit,
  onInherit,
  onDrillIn,
}: LevelRendererProps & { onDrillIn: (folderPath: string) => void }) {
  const labelFont = useMemo(() => uiFont(12), []);

  return (
    <div className="h-full overflow-y-auto">
      {levels.map((level, levelIndex) => {
        const { value } = levelName(levelTargets(level).targets, labels);
        return (
          <section key={levelIndex} className={levelIndex > 0 ? "border-t border-neutral-700/60" : ""}>
            <div className="flex items-center gap-3 px-5 pt-2.5">
              <LevelNameInput
                key={levelKey(level)}
                value={value}
                placeholder={levelPlaceholder(level, labels)}
                onCommit={(name) => onCommit(levelIndex, name)}
                className="flex-1 text-[15px] text-neutral-400"
              />
              <InheritNameButton onClick={() => onInherit(levelIndex)} />
              <span className="shrink-0 text-[11px] text-neutral-500">
                {levelCaption(level, savedLevel === levelIndex, folderName)}
              </span>
            </div>
            {level.groups.map((group) => (
              <div key={group.parentPath}>
                {level.groups.length > 1 && (
                  <h3 className="px-5 pt-2 text-[11px] font-medium text-neutral-500">
                    {folderName(group.parentPath)}
                  </h3>
                )}
                <div
                  className="grid justify-start gap-y-3 p-4"
                  style={{ gridTemplateColumns: `repeat(auto-fill, ${TILE_WIDTH}px)`, columnGap: COLUMN_GAP }}
                >
                  {group.nodes.map((node) => (
                    <FolderTile
                      key={node.folder_path}
                      node={node}
                      label={labels[node.folder_path]}
                      isSelected={level.selected.includes(node.folder_path)}
                      labelFont={labelFont}
                      onSelect={() => onToggle(levelIndex, node.folder_path)}
                      onDrillIn={() => onDrillIn(node.folder_path)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
