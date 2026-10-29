import type { FileRecord } from "../../types";
import type { FolderEntry } from "../../lib/folderTree";
import type { MenuEntry } from "../../lib/nativeMenu";
import FileTable from "./shared/FileTable";
import type { DragItem } from "../../lib/filing";

interface Props {
  files: FileRecord[];
  /** The view's folders here, listed before the files. */
  folders?: FolderEntry[];
  onOpenFolder?: (value: string) => void;
  folderMenu?: (value: string) => MenuEntry[];
  backgroundMenu?: () => MenuEntry[];
  /** The folder showing (its path), for filing by drag. */
  place?: string[];
  /** Where a folder (by its value) takes what's dropped on it. */
  folderPath?: (value: string) => string[];
  /** A right-click on files: the menu for those. */
  fileMenu?: (items: DragItem[]) => MenuEntry[];
}

export default function ListView({ files, folders, onOpenFolder, folderMenu, backgroundMenu, place, folderPath, fileMenu }: Props) {
  return (
    <FileTable
      files={files}
      folders={folders}
      onOpenFolder={onOpenFolder}
      folderMenu={folderMenu}
      backgroundMenu={backgroundMenu}
      place={place}
      folderPath={folderPath}
      fileMenu={fileMenu}
      storageKey="list"
    />
  );
}
