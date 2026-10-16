import { convertFileSrc } from "@tauri-apps/api/core";
import { getThumbnail } from "./commands";

// Quick Look thumbnails for tiles: requested as tiles come into view, a few at a
// time so a folder of thousands doesn't flood the renderer, and remembered for
// the session (the backend also caches them on disk).

const MAX_IN_FLIGHT = 4;
const cache = new Map<string, Promise<string | null>>();
const waiting: Array<() => void> = [];
let inFlight = 0;

function runQueued<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      inFlight++;
      task()
        .then(resolve, reject)
        .finally(() => {
          inFlight--;
          waiting.shift()?.();
        });
    };
    if (inFlight < MAX_IN_FLIGHT) start();
    else waiting.push(start);
  });
}

/** URL of `path`'s thumbnail at `size` points (for the screen's scale), or null when it has none. */
export function thumbnailUrl(path: string, size: number): Promise<string | null> {
  const scale = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  const key = `${size}@${scale}:${path}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = runQueued(() => getThumbnail(path, size, scale))
      .then((file) => (file ? convertFileSrc(file) : null))
      .catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}
