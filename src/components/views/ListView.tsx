import { FileIcon } from "../../lib/fileIcons";
import { openPath } from "../../lib/commands";
import type { FileRecord } from "../../types";

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return value;
  }
}

function mimeLabel(mimeType: string | null): string {
  if (!mimeType) return "File";
  if (mimeType.startsWith("image/"))
    return mimeType.replace("image/", "").toUpperCase() + " Image";
  if (mimeType.startsWith("video/"))
    return mimeType.replace("video/", "").toUpperCase() + " Video";
  if (mimeType.startsWith("audio/"))
    return mimeType.replace("audio/", "").toUpperCase() + " Audio";
  if (mimeType === "application/pdf") return "PDF Document";
  if (mimeType.startsWith("text/")) return "Text";
  return mimeType.split("/")[1] ?? "File";
}

function fileName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

interface Props {
  files: FileRecord[];
}

const TH =
  "px-3 py-2 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide";
const TD = "px-3 py-2 text-sm text-neutral-300";

export default function ListView({ files }: Props) {
  async function handleOpen(filePath: string) {
    try {
      await openPath(filePath);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-neutral-900/95 backdrop-blur-sm z-10">
          <tr className="border-b border-neutral-700/60">
            <th className={TH}>Name</th>
            <th className={TH}>Type</th>
            <th className={TH}>Date Modified</th>
            <th className={TH + " text-right"}>Size</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const name = fileName(file.file_path);
            const date = formatDate(file.modified_at ?? file.timestamp);
            const size = formatBytes(file.file_size);
            return (
              <tr
                key={file.file_id}
                onDoubleClick={() => handleOpen(file.file_path)}
                className="border-b border-neutral-800/50 hover:bg-neutral-800/40 transition-colors cursor-default"
              >
                <td className={TD}>
                  <div className="flex items-center gap-2">
                    <FileIcon
                      mimeType={file.file_type}
                      className="w-4 h-4 shrink-0"
                    />
                    <span className="truncate max-w-xs">{name}</span>
                  </div>
                </td>
                <td className={TD + " text-neutral-500"}>
                  {mimeLabel(file.file_type)}
                </td>
                <td className={TD + " text-neutral-500"}>{date}</td>
                <td className={TD + " text-right text-neutral-500"}>{size}</td>
              </tr>
            );
          })}
          {files.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="px-3 py-8 text-center text-neutral-600 text-sm"
              >
                No files
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
