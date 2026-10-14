import type { FileRecord } from "../../types";
import FileTable from "./shared/FileTable";

interface Props {
  files: FileRecord[];
}

export default function ListView({ files }: Props) {
  return <FileTable files={files} storageKey="list" />;
}
