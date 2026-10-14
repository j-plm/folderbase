import { useEffect, useState, type ReactNode } from "react";
import { getNativeIcon } from "./commands";

export function isImageMime(mimeType: string | null): boolean {
  return !!mimeType && mimeType.startsWith("image/");
}

function iconPath(d: string, color: string): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-full h-full"
    >
      <path d={d} />
    </svg>
  );
}

function FallbackFolderIcon({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full"
      >
        <path d="M2 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
      </svg>
    </div>
  );
}

function FallbackFileIcon({
  mimeType,
  className,
}: {
  mimeType: string | null;
  className?: string;
}) {
  const mime = mimeType ?? "";

  let icon: ReactNode;

  if (mime.startsWith("image/")) {
    icon = iconPath(
      "M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 7l4-4 3 3 3-3 5 5",
      "#60a5fa"
    );
  } else if (mime.startsWith("video/")) {
    icon = iconPath(
      "M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M4 8h11a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4a2 2 0 012-2z",
      "#c084fc"
    );
  } else if (mime.startsWith("audio/")) {
    icon = iconPath(
      "M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z",
      "#34d399"
    );
  } else if (mime === "application/pdf") {
    icon = iconPath(
      "M7 21H5a2 2 0 01-2-2V5a2 2 0 012-2h7l7 7v9a2 2 0 01-2 2h-2M9 17H7m4-4H7m6-6v4h4",
      "#f87171"
    );
  } else if (mime.startsWith("text/")) {
    icon = iconPath(
      "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z",
      "#94a3b8"
    );
  } else {
    icon = iconPath(
      "M7 21H5a2 2 0 01-2-2V5a2 2 0 012-2h10l6 6v12a2 2 0 01-2 2h-2",
      "#6b7280"
    );
  }

  return <div className={className}>{icon}</div>;
}


/** Lowercase extension of a path's file name, without the dot ("" if none). */
export function fileExtension(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// Native icons are rendered by the OS once per kind + pixel size and shared.
const pendingIcons = new Map<string, Promise<string | null>>();
const loadedIcons = new Map<string, string | null>();

function loadNativeIcon(key: string, kind: string, px: number): Promise<string | null> {
  let pending = pendingIcons.get(key);
  if (!pending) {
    pending = getNativeIcon(kind, px)
      .catch(() => null)
      .then((src) => {
        loadedIcons.set(key, src);
        return src;
      });
    pendingIcons.set(key, pending);
  }
  return pending;
}

/**
 * Native icon for "folder", a file extension or "symbol:<name>" at `size` points.
 * `undefined` while loading, `null` if the OS couldn't provide one. Callers draw
 * nothing while loading (so a fallback never flashes in before the native icon)
 * and only fall back when it is `null`.
 */
function useNativeIcon(kind: string, size: number): string | null | undefined {
  const px = Math.round(size * (window.devicePixelRatio || 1));
  const key = `${kind}@${px}`;
  const [src, setSrc] = useState<string | null | undefined>(() => loadedIcons.get(key));

  useEffect(() => {
    let cancelled = false;
    setSrc(loadedIcons.get(key));
    loadNativeIcon(key, kind, px).then((s) => {
      if (!cancelled) setSrc(s);
    });
    return () => {
      cancelled = true;
    };
  }, [key, kind, px]);

  return src;
}

interface IconProps {
  /** Rendered width and height in CSS pixels. */
  size?: number;
  className?: string;
}

export function FolderIcon({ size = 32, className = "" }: IconProps) {
  const src = useNativeIcon("folder", size);
  return src ? (
    <img src={src} width={size} height={size} draggable={false} alt="" className={`shrink-0 ${className}`} />
  ) : (
    <div style={{ width: size, height: size }} className={`shrink-0 text-blue-500 ${className}`}>
      {src === null && <FallbackFolderIcon />}
    </div>
  );
}

export function FileIcon({
  path,
  mimeType,
  size = 32,
  className = "",
}: IconProps & { path: string; mimeType: string | null }) {
  const src = useNativeIcon(fileExtension(path), size);
  return src ? (
    <img src={src} width={size} height={size} draggable={false} alt="" className={`shrink-0 ${className}`} />
  ) : (
    <div style={{ width: size, height: size }} className={`shrink-0 ${className}`}>
      {src === null && <FallbackFileIcon mimeType={mimeType} />}
    </div>
  );
}

/**
 * A native SF Symbol (Finder's sidebar line icons), tinted with the current
 * text colour: the OS-rendered glyph is used as a mask over `currentColor`.
 */
export function SymbolIcon({
  name,
  size = 16,
  className = "",
  fallback,
}: IconProps & { name: string; fallback?: ReactNode }) {
  const src = useNativeIcon(`symbol:${name}`, size);
  if (!src) {
    return (
      <span style={{ width: size, height: size }} className={`inline-flex shrink-0 ${className}`}>
        {src === null && fallback}
      </span>
    );
  }
  const mask = `url("${src}") center / contain no-repeat`;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, backgroundColor: "currentColor", mask, WebkitMask: mask }}
      className={`inline-block shrink-0 ${className}`}
    />
  );
}
