import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface UseDragDropOptions {
  onFiles: (paths: string[]) => void;
}

interface UseDragDropResult {
  isDragging: boolean;
}

export function useDragDrop({ onFiles }: UseDragDropOptions): UseDragDropResult {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter") {
          setIsDragging(true);
        } else if (event.payload.type === "leave") {
          setIsDragging(false);
        } else if (event.payload.type === "drop") {
          setIsDragging(false);
          if (event.payload.paths.length > 0) {
            onFiles(event.payload.paths);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [onFiles]);

  return { isDragging };
}
