// Words and choices the Settings window shows, kept pure so they're tested.

import type { PathMappingNode } from "./commands";
import type { StoredRule } from "./rules";

/** A size as Finder shows it: decimal units, "Zero bytes" for nothing. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "Zero bytes";
  if (bytes < 1000) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")} ${units[unit]}`;
}

/** Map Disk Folders, summed up: how many levels of folders are mapped ("3 levels mapped"). */
export function mappingSummary(nodes: Pick<PathMappingNode, "depth">[]): string {
  const levels = new Set(nodes.map((n) => n.depth)).size;
  if (levels === 0) return "Nothing mapped";
  return `${levels} ${levels === 1 ? "level" : "levels"} mapped`;
}

/** Rules, summed up: how many, and how many are on ("4 rules, 3 on"). */
export function rulesSummary(rules: Pick<StoredRule, "enabled">[]): string {
  if (rules.length === 0) return "No rules";
  const on = rules.filter((r) => r.enabled).length;
  const count = `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`;
  if (on === rules.length) return rules.length === 1 ? `${count}, on` : `${count}, all on`;
  if (on === 0) return rules.length === 1 ? `${count}, off` : `${count}, all off`;
  return `${count}, ${on} on`;
}

/** The folders a click on the excluded-folders checklist changes, outermost only (what's inside is covered). */
export function outermost(paths: string[]): string[] {
  const inside = (p: string, o: string) => p.startsWith(`${o}/`) || p.startsWith(`${o}\\`);
  return paths.filter((p) => !paths.some((o) => o !== p && inside(p, o)));
}

/**
 * The location to open on launch: the last one open (if it's still there)
 * or else the first, as Settings ▸ General ▸ On launch says.
 */
export function launchLocation(onLaunch: "last" | "first", locationIds: string[], last: string | null): string | null {
  if (onLaunch === "last" && last && locationIds.includes(last)) return last;
  return locationIds[0] ?? null;
}
