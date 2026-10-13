import { convertFileSrc } from "@tauri-apps/api/core";
import { FileIcon, isImageMime } from "../../lib/fileIcons";
import { openPath } from "../../lib/commands";
import type { FileRecord } from "../../types";

interface Props {
  files: FileRecord[];
}

function fileName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

export default function TilesView({ files }: Props) {
  async function handleOpen(filePath: string) {
    try {
      await openPath(filePath);
    } catch {
      // ignore
    }
  }

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-neutral-600 text-sm">
        No files
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 p-4">
        {files.map((file) => {
          const name = fileName(file.file_path);
          return (
            <div
              key={file.file_id}
              onDoubleClick={() => handleOpen(file.file_path)}
              className="flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-neutral-800/70 transition-colors cursor-default select-none"
            >
              <div className="w-full aspect-square rounded overflow-hidden bg-neutral-800 flex items-center justify-center">
                {isImageMime(file.file_type) ? (
                  <img
                    src={convertFileSrc(file.file_path)}
                    alt={name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display =
                        "none";
                    }}
                  />
                ) : (
                  <FileIcon mimeType={file.file_type} className="w-10 h-10" />
                )}
              </div>
              <span className="text-xs text-neutral-300 text-center line-clamp-2 w-full break-words leading-tight">
                {name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
