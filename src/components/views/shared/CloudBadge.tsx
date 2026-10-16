import { SymbolIcon } from "../../../lib/fileIcons";

/** Width a badge takes beside a name, including its gap. */
export const CLOUD_BADGE_WIDTH = 18;

/**
 * Finder's "online only" cloud glyph, for a cloud file that isn't downloaded.
 * Opening the file downloads it, as the cloud provider handles natively.
 */
export default function CloudBadge({ show, className = "" }: { show: boolean | undefined; className?: string }) {
  if (!show) return null;
  return (
    <span title="Online only: downloads when opened" className={`shrink-0 inline-flex ${className}`}>
      <SymbolIcon name="icloud.and.arrow.down" size={12} fallback="☁" className="opacity-60" />
    </span>
  );
}
