import type { ReactNode } from "react";

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

export function FolderIcon({ className = "w-8 h-8" }: { className?: string }) {
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

export function FileIcon({
  mimeType,
  className = "w-8 h-8",
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

