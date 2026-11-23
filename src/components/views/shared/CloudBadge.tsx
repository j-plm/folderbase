import { SymbolIcon } from "../../../lib/fileIcons";

/** Width a badge takes beside a name, including its gap. */
export const CLOUD_BADGE_WIDTH = 18;

/** Whether a file shows a cloud badge: it isn't here, or its drive can't say. */
export function hasCloudBadge(file: { online_only?: boolean; streamed?: boolean } | null | undefined): boolean {
  return !!(file?.online_only || file?.streamed);
}

/**
 * Finder's "online only" cloud glyph, for a cloud file that isn't downloaded
 * (all of it). A plain cloud for a file on a streamed drive that can't say
 * whether it's here (see src-tauri/src/commands/cloud.rs). Opening the file
 * downloads it either way, as the cloud provider handles natively.
 */
export default function CloudBadge({
  file,
  className = "",
}: {
  file: { online_only?: boolean; streamed?: boolean } | null | undefined;
  className?: string;
}) {
  if (!hasCloudBadge(file)) return null;
  const known = !!file?.online_only;
  return (
    <span
      title={known ? "Not downloaded: downloads when opened" : "Streamed from the cloud: downloads when opened"}
      className={`shrink-0 inline-flex ${className}`}
    >
      <SymbolIcon name={known ? "icloud.and.arrow.down" : "icloud"} size={12} fallback="☁" className="opacity-60" />
    </span>
  );
}
