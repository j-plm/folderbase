import { useMemo } from "react";
import type { FileRecord } from "../../types";
import { fileNode } from "../../lib/columnBrowser";
import ColumnBrowser from "./columns/ColumnBrowser";

interface Props {
  files: FileRecord[];
}

// Locations are flat lists of files for now, so the browser shows one column.
// When folder data is available, pass folder nodes (with `children`) and they
// open into new columns.
export default function ColumnsView({ files }: Props) {
  const root = useMemo(() => files.map(fileNode), [files]);
  return <ColumnBrowser root={root} />;
}
