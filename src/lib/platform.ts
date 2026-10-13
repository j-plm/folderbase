type Platform = "macos" | "windows" | "linux";

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "macos";
  if (ua.includes("windows")) return "windows";
  return "linux";
}

const platform = detectPlatform();

export const labels = {
  sidebar: platform === "macos" ? "Sidebar" : "Navigation",
  trash:
    platform === "windows"
      ? "Delete"
      : "Move to Trash",
  newFolder: "New Folder",
} as const;

export const breadcrumbSeparator = platform === "windows" ? "\\" : "/";

export { platform };
