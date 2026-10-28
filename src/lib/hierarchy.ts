import { NO_VALUE, folderKeys, noValuePlacement, sameFolderLevel } from "./folderTree";
import type { ValueReader } from "./fileValues";
import type { Scope } from "./scopes";
import type { FolderLevel } from "./tableViews";
import type { FileRecord, ValueType } from "../types";

// Editing a view's hierarchy of properties (the hierarchy editor): the
// levels in order, with branches inside particular folders. Pure; the
// hierarchy itself is the saved FolderLevel tree.
//
// A *chain* is a run of levels linked by `next`. The top chain starts at the
// root; a fork is a chain of its own, inside one folder of a level. A chain
// is addressed by the forks leading to it.

/** The forks leading to a chain: each the level at `index` in the chain so far, and its fork for folder `value`. */
export type ChainAddress = { index: number; value: string }[];

/** A place in a chain: before the level at `index` (or after the last). */
export interface LevelSlot {
  chain: ChainAddress;
  index: number;
}

type Direction = FolderLevel["direction"];

const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** A chain's levels in order. */
function listOf(head: FolderLevel | null): FolderLevel[] {
  const levels: FolderLevel[] = [];
  for (let level = head; level; level = level.next) levels.push(level);
  return levels;
}

/** Levels linked back into a chain (each level's own `next` replaced). */
function linkList(levels: FolderLevel[]): FolderLevel | null {
  let next: FolderLevel | null = null;
  for (let i = levels.length - 1; i >= 0; i--) next = { ...levels[i], next };
  return next;
}

/** The levels of the chain at an address, in order (none if it isn't there). */
export function chainAt(root: FolderLevel | null, chain: ChainAddress): FolderLevel[] {
  let head = root;
  for (const step of chain) {
    const level = listOf(head)[step.index];
    if (!level || !has(level.branches, step.value)) return [];
    head = level.branches[step.value];
  }
  return listOf(head);
}

/** The structure with the chain at an address replaced. */
function withChain(root: FolderLevel | null, chain: ChainAddress, head: FolderLevel | null): FolderLevel | null {
  if (chain.length === 0) return head;
  const [step, ...rest] = chain;
  const levels = listOf(root);
  const level = levels[step.index];
  if (!level || !has(level.branches, step.value)) return root;
  const copy = levels.slice();
  copy[step.index] = { ...level, branches: { ...level.branches, [step.value]: withChain(level.branches[step.value], rest, head) } };
  return linkList(copy);
}

/**
 * A fork that ended by carrying on as usual (its last levels the same as what
 * followed its level) carries on as usual still: that ending becomes `to`.
 */
function carryOn(fork: FolderLevel | null, from: FolderLevel | null, to: FolderLevel | null): FolderLevel | null {
  const levels = listOf(fork);
  for (let p = 0; p <= levels.length; p++) {
    // A fork of files only stays that way: an empty ending matches only an empty "as usual"
    if (p === levels.length && from !== null) break;
    if (sameFolderLevel(p < levels.length ? levels[p] : null, from)) return linkList([...levels.slice(0, p), ...listOf(to)]);
  }
  return fork;
}

/**
 * Changes the chain at an address. Levels kept as they were (the same
 * objects) keep their forks carrying on as usual through what now follows them.
 */
function editChain(root: FolderLevel | null, chain: ChainAddress, edit: (levels: FolderLevel[]) => FolderLevel[]): FolderLevel | null {
  const before = chainAt(root, chain);
  const after = edit(before);
  const kept = after.map((level, j) => {
    const i = before.indexOf(level);
    if (i === -1 || Object.keys(level.branches).length === 0) return level;
    const from = before[i + 1] ?? null;
    const to = linkList(after.slice(j + 1));
    if (sameFolderLevel(from, to)) return level;
    const branches: Record<string, FolderLevel | null> = {};
    for (const [value, fork] of Object.entries(level.branches)) branches[value] = carryOn(fork, from, to);
    return { ...level, branches };
  });
  return tidyFolders(withChain(root, chain, linkList(kept)));
}

/** Drops forks the same as what usually follows their level (they no longer differ). */
export function tidyFolders(root: FolderLevel | null): FolderLevel | null {
  return linkList(
    listOf(root).map((level) => {
      const usual = level.next;
      const branches: Record<string, FolderLevel | null> = {};
      for (const [value, fork] of Object.entries(level.branches)) {
        const tidy = tidyFolders(fork);
        if (!sameFolderLevel(tidy, usual)) branches[value] = tidy;
      }
      return { ...level, branches };
    })
  );
}

const newLevel = (column: string, direction: Direction): FolderLevel => ({ column, direction, next: null, branches: {} });

/** Every level's skipping of single folders, on or off (branches' levels too). */
export function setSkipSingleEverywhere(root: FolderLevel | null, on: boolean): FolderLevel | null {
  if (!root) return null;
  const { skipSingle: _was, ...rest } = root;
  const branches: Record<string, FolderLevel | null> = {};
  for (const [value, fork] of Object.entries(root.branches)) branches[value] = setSkipSingleEverywhere(fork, on);
  return { ...rest, ...(on ? { skipSingle: true as const } : {}), next: setSkipSingleEverywhere(root.next, on), branches };
}

/** Whether every level (branches' too) skips single folders. */
export function skipsSingleEverywhere(root: FolderLevel | null): boolean {
  const all = (level: FolderLevel | null): boolean =>
    level === null || (!!level.skipSingle && all(level.next) && Object.values(level.branches).every(all));
  return root !== null && all(root);
}

/** Every level, branches' levels too. */
export function everyLevel(root: FolderLevel | null): FolderLevel[] {
  return listOf(root).flatMap((level) => [level, ...Object.values(level.branches).flatMap(everyLevel)]);
}

/** A setting across the levels it applies to: on at all, off at all, or mixed (none when it applies to none). */
export function settingAcross(
  root: FolderLevel | null,
  applies: (level: FolderLevel) => boolean,
  on: (level: FolderLevel) => boolean
): "on" | "off" | "mixed" | null {
  const levels = everyLevel(root).filter(applies);
  if (levels.length === 0) return null;
  const count = levels.filter(on).length;
  return count === levels.length ? "on" : count === 0 ? "off" : "mixed";
}

/** Changes every level's settings (branches' too); `patch` gives none for a level it leaves as it is. */
export function setEveryLevel(root: FolderLevel | null, patch: (level: FolderLevel) => LevelPatch | null): FolderLevel | null {
  return linkList(
    listOf(root).map((level) => {
      const branches: Record<string, FolderLevel | null> = {};
      for (const [value, fork] of Object.entries(level.branches)) branches[value] = setEveryLevel(fork, patch);
      const change = patch(level);
      return { ...(change ? patched(level, change) : level), branches };
    })
  );
}

/** Adds a level at a slot. */
export function insertLevel(root: FolderLevel | null, slot: LevelSlot, column: string, direction: Direction): FolderLevel | null {
  return editChain(root, slot.chain, (levels) => [...levels.slice(0, slot.index), newLevel(column, direction), ...levels.slice(slot.index)]);
}

/** Removes a level, with its forks; the chain closes up. */
export function removeLevel(root: FolderLevel | null, slot: LevelSlot): FolderLevel | null {
  return editChain(root, slot.chain, (levels) => levels.filter((_, i) => i !== slot.index));
}

export function setDirection(root: FolderLevel | null, slot: LevelSlot, direction: Direction): FolderLevel | null {
  return setLevel(root, slot, { direction });
}

/** A change to a level's settings. */
export type LevelPatch = Partial<Pick<FolderLevel, "direction" | "noValue" | "allValues" | "dateUnit" | "skipSingle">>;

function patched(level: FolderLevel, patch: LevelPatch): FolderLevel {
  const changed: FolderLevel = { ...level, ...patch };
  // A setting turned off is left out, as a level that never had it
  if (!changed.noValue) delete changed.noValue;
  if (!changed.allValues) delete changed.allValues;
  if (!changed.dateUnit) delete changed.dateUnit;
  if (!changed.skipSingle) delete changed.skipSingle;
  return changed;
}

/** Changes a level's settings: its order, where files without a value go, whether every value shows. */
export function setLevel(root: FolderLevel | null, slot: LevelSlot, patch: LevelPatch): FolderLevel | null {
  return editChain(root, slot.chain, (levels) => levels.map((l, i) => (i === slot.index ? patched(l, patch) : l)));
}

/**
 * Adds a level just inside one folder of a level: that folder's contents
 * get it first, then carry on as before (as usual, or as its fork already ran).
 */
export function forkAt(root: FolderLevel | null, slot: LevelSlot, value: string, column: string, direction: Direction): FolderLevel | null {
  return editChain(root, slot.chain, (levels) =>
    levels.map((level, i) => {
      if (i !== slot.index) return level;
      const inside = has(level.branches, value) ? level.branches[value] : linkList(levels.slice(i + 1));
      return { ...level, branches: { ...level.branches, [value]: { ...newLevel(column, direction), next: inside } } };
    })
  );
}

/** Removes a fork: the folder goes back to what usually follows its level. */
export function removeFork(root: FolderLevel | null, slot: LevelSlot, value: string): FolderLevel | null {
  return editChain(root, slot.chain, (levels) =>
    levels.map((level, i) => {
      if (i !== slot.index || !has(level.branches, value)) return level;
      const branches = { ...level.branches };
      delete branches[value];
      return { ...level, branches };
    })
  );
}

/** Whether `chain` is `inside` itself or one of its forks (at any depth). */
function within(chain: ChainAddress, inside: ChainAddress): boolean {
  return inside.length <= chain.length && inside.every((s, i) => s.index === chain[i].index && s.value === chain[i].value);
}

/**
 * Moves a level, with its forks, to another slot (in its own chain or
 * another). Its forks that carried on as usual carry on as usual where it
 * lands. A level can't move into one of its own forks: the structure is unchanged.
 */
export function moveLevel(root: FolderLevel | null, from: LevelSlot, to: LevelSlot): FolderLevel | null {
  const source = chainAt(root, from.chain);
  const level = source[from.index];
  if (!level) return root;
  // Into one of its own forks: nowhere to go
  if (to.chain.length > from.chain.length && within(to.chain, from.chain) && to.chain[from.chain.length].index === from.index) {
    return root;
  }
  // Its forks, without the "as usual" ending (put back where it lands)
  const usual = source[from.index + 1] ?? null;
  const carried = new Map<string, FolderLevel[]>();
  const fixed: Record<string, FolderLevel | null> = {};
  for (const [value, fork] of Object.entries(level.branches)) {
    const levels = listOf(fork);
    const at = levels.findIndex((_, p) => sameFolderLevel(levels[p], usual));
    if (usual !== null && at !== -1) carried.set(value, levels.slice(0, at));
    else if (usual === null) carried.set(value, levels);
    else fixed[value] = fork;
  }

  const removed = editChain(root, from.chain, (levels) => levels.filter((_, i) => i !== from.index));
  // Taking the level out shifts what comes after it in its chain, the target included
  const target: LevelSlot = { chain: to.chain.map((s) => ({ ...s })), index: to.index };
  if (within(to.chain, from.chain)) {
    if (to.chain.length === from.chain.length) {
      if (to.index > from.index) target.index--;
    } else if (to.chain[from.chain.length].index > from.index) {
      target.chain[from.chain.length].index--;
    }
  }
  return editChain(removed, target.chain, (levels) => {
    const after = linkList(levels.slice(target.index));
    const branches: Record<string, FolderLevel | null> = { ...fixed };
    for (const [value, start] of carried) branches[value] = linkList([...start, ...listOf(after)]);
    return [...levels.slice(0, target.index), { ...level, branches }, ...levels.slice(target.index)];
  });
}

/**
 * The level inside a folder (at a path of folder values; [] the top level),
 * as a slot to change it by: through a fork where the folder has one. Null
 * where there's no level there (files only).
 */
export function slotAt(root: FolderLevel | null, path: string[]): LevelSlot | null {
  const chain: ChainAddress = [];
  let level = root;
  let index = 0;
  for (const value of path) {
    if (!level) return null;
    if (has(level.branches, value)) {
      chain.push({ index, value });
      level = level.branches[value];
      index = 0;
    } else {
      level = level.next;
      index++;
    }
  }
  return level ? { chain, index } : null;
}

/**
 * Moves a level to just inside one folder of another level (dropped on that
 * folder): the folder's contents get it first, then carry on as before. It
 * can't go inside one of its own folders, nor inside one of its own forks.
 */
export function moveIntoFork(root: FolderLevel | null, from: LevelSlot, at: LevelSlot, value: string): FolderLevel | null {
  const level = chainAt(root, from.chain)[from.index];
  if (!level) return root;
  const ownForks = (chain: ChainAddress) =>
    chain.length > from.chain.length && within(chain, from.chain) && chain[from.chain.length].index === from.index;
  if ((within(at.chain, from.chain) && at.chain.length === from.chain.length && at.index === from.index) || ownForks(at.chain)) {
    return root;
  }
  const forked = forkAt(root, at, value, level.column, level.direction);
  // A level already inside that fork has moved down one, behind the one just added
  const depth = at.chain.length;
  const source: LevelSlot = { chain: from.chain.map((s) => ({ ...s })), index: from.index };
  const throughFork =
    from.chain.length > depth && within(from.chain, at.chain) && from.chain[depth].index === at.index && from.chain[depth].value === value;
  if (throughFork) {
    if (from.chain.length === depth + 1) source.index++;
    else source.chain[depth + 1].index++;
  }
  return removeLevel(forked, source);
}

/** A level's example folders: values with their file counts, in the order the level shows them. */
export interface LevelExamples {
  values: { value: string; label: string; count: number }[];
  /** How many more folders there are. */
  more: number;
}

function compareRank(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The folders a column would make of these files (a Multi-select's values each
 * count; "No Client" last), the first `limit` of them in the level's order.
 */
export function levelExamples(
  files: FileRecord[],
  level: Pick<FolderLevel, "column" | "direction" | "noValue" | "dateUnit">,
  reader: ValueReader,
  typeOf: (name: string) => ValueType,
  noValueLabel: string,
  limit = 5
): LevelExamples {
  const { column, direction } = level;
  // Files without a value sit loose at this level: no "No Client" folder; otherwise those it doesn't apply to are in it too
  const loose = noValuePlacement(level, reader) === "loose";
  const found = new Map<string, { value: string; label: string; rank: string | number; count: number }>();
  for (const file of files) {
    const none = [{ value: NO_VALUE, label: "", rank: "" as string | number }];
    for (const key of folderKeys(file, column, reader, typeOf, level.dateUnit) ?? none) {
      if (loose && key.value === NO_VALUE) continue;
      const entry = found.get(key.value);
      if (entry) entry.count++;
      else found.set(key.value, { ...key, label: key.value === NO_VALUE ? noValueLabel : key.label, count: 1 });
    }
  }
  const sign = direction === "desc" ? -1 : 1;
  const sorted = [...found.values()].sort((a, b) => {
    if ((a.value === NO_VALUE) !== (b.value === NO_VALUE)) return a.value === NO_VALUE ? 1 : -1;
    return sign * compareRank(a.rank, b.rank);
  });
  return {
    values: sorted.slice(0, limit).map(({ value, label, count }) => ({ value, label, count })),
    more: Math.max(0, sorted.length - limit),
  };
}

/** The files a chain sees: those in the folders its forks are inside. */
export function chainFiles(
  files: FileRecord[],
  root: FolderLevel | null,
  chain: ChainAddress,
  reader: ValueReader,
  typeOf: (name: string) => ValueType
): FileRecord[] {
  let result = files;
  for (let d = 0; d < chain.length; d++) {
    const level = chainAt(root, chain.slice(0, d))[chain[d].index];
    if (!level) return [];
    const { value } = chain[d];
    result = result.filter((f) => folderKeys(f, level.column, reader, typeOf, level.dateUnit)?.some((k) => k.value === value));
  }
  return result;
}

/**
 * Where a scoped property naturally goes: inside the folder of its condition
 * ("Housing applies when Tags has housing": inside Tags › housing), when its
 * condition's property is a level of the top chain and that folder doesn't
 * hold it yet. Its value is as the scope names it; match it to the level's folders.
 */
export function scopeSuggestion(root: FolderLevel | null, scope: Scope): { slot: LevelSlot; value: string } | null {
  if (scope.conditions.length !== 1) return null;
  const { property, value } = scope.conditions[0];
  const index = listOf(root).findIndex((l) => l.column === `prop:${property}`);
  if (index === -1) return null;
  const inside = chainAt(root, [{ index, value }]);
  if (inside.some((l) => l.column === `prop:${scope.property}`)) return null;
  return { slot: { chain: [], index }, value };
}
