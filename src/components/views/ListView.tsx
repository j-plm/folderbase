import type { FileRecord } from "../../types";
import type { FolderEntry } from "../../lib/folderTree";
import type { MenuEntry } from "../../lib/nativeMenu";
import FileTable from "./shared/FileTable";

interface Props {
  files: FileRecord[];
  /** The view's folders here, listed before the files. */
  folders?: FolderEntry[];
  onOpenFolder?: (value: string) => void;
  folderMenu?: (value: string) => MenuEntry[];
  backgroundMenu?: () => MenuEntry[];
}

export default function ListView({ files, folders, onOpenFolder, folderMenu, backgroundMenu }: Props) {
  return (
    <FileTable
      files={files}
      folders={folders}
      onOpenFolder={onOpenFolder}
      folderMenu={folderMenu}
      backgroundMenu={backgroundMenu}
      storageKey="list"
    />
  );
}
