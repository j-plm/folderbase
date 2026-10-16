import { useEffect, useRef, useState } from "react";
import { FileIcon } from "../../../lib/fileIcons";
import { thumbnailUrl } from "../../../lib/thumbnails";

/**
 * A file's Quick Look thumbnail, as Finder's icon view shows it: the file's
 * icon until the tile scrolls near the screen and its thumbnail is ready,
 * and the icon for files without one.
 */
export default function Thumbnail({ path, mimeType, size }: { path: string; mimeType: string | null; size: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        thumbnailUrl(path, size).then((url) => {
          if (!cancelled) setSrc(url);
        });
      },
      // Start a screenful ahead so thumbnails are usually ready by the time they're seen
      { rootMargin: "100% 0px" }
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [path, size]);

  return (
    <div ref={ref} style={{ width: size, height: size }} className="flex items-center justify-center">
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          style={{ maxWidth: size, maxHeight: size }}
          className="object-contain shadow-sm"
          onError={() => setSrc(null)}
        />
      ) : (
        <FileIcon path={path} mimeType={mimeType} size={size} />
      )}
    </div>
  );
}
