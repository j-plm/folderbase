import { isActiveRule, isFilterGroup, type FilterGroup, type FilterItem, type FilterMatch, type FilterRule } from "./dbTable";

// Filter lists with groups (the Filter panel's, a rule's When): filters and
// groups of them, each group with its own And/Or. Pure: every change returns
// a new list. A group left with nothing in it goes, as it would say nothing.

/** How deep groups go: a group, and groups inside it. */
export const MAX_GROUP_DEPTH = 2;

const newId = () => Math.random().toString(36).slice(2);

export function newGroup(match: FilterMatch, items: FilterItem[]): FilterGroup {
  return { id: newId(), match, items };
}

export const otherMatch = (match: FilterMatch): FilterMatch => (match === "all" ? "any" : "all");

/** Every filter in the list, groups opened up, in order. */
export function filterRules(items: FilterItem[]): FilterRule[] {
  return items.flatMap((item) => (isFilterGroup(item) ? filterRules(item.items) : [item]));
}

/** Each filter replaced by what `fn` returns (null removes it); groups left empty go. */
export function mapRules(items: FilterItem[], fn: (rule: FilterRule) => FilterRule | null): FilterItem[] {
  const out: FilterItem[] = [];
  for (const item of items) {
    if (isFilterGroup(item)) {
      const inner = mapRules(item.items, fn);
      if (inner.length > 0) out.push({ ...item, items: inner });
    } else {
      const next = fn(item);
      if (next) out.push(next);
    }
  }
  return out;
}

export function updateRule(items: FilterItem[], id: string, patch: Partial<FilterRule>): FilterItem[] {
  return mapRules(items, (r) => (r.id === id ? { ...r, ...patch } : r));
}

/** The filters that narrow anything (with a value, or "is empty"), in their groups. */
export function activeFilters(items: FilterItem[]): FilterItem[] {
  return mapRules(items, (r) => (isActiveRule(r) ? r : null));
}

/** Where an item sits: its group (null: the top of the list) and its place in it. */
export function locate(items: FilterItem[], id: string, parent: FilterGroup | null = null): { parent: FilterGroup | null; index: number } | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.id === id) return { parent, index: i };
    if (isFilterGroup(item)) {
      const found = locate(item.items, id, item);
      if (found) return found;
    }
  }
  return null;
}

export function findItem(items: FilterItem[], id: string): FilterItem | null {
  const at = locate(items, id);
  return at ? (at.parent ? at.parent.items : items)[at.index] : null;
}

/** How deep a group sits (1: in the list itself, 2: in a group); 0 for the list itself (null). */
export function depthOf(items: FilterItem[], groupId: string | null): number {
  if (groupId == null) return 0;
  const at = locate(items, groupId);
  return at ? depthOf(items, at.parent?.id ?? null) + 1 : 0;
}

/** How many levels of groups an item brings: 0 for a filter. */
function height(item: FilterItem): number {
  return isFilterGroup(item) ? 1 + Math.max(0, ...item.items.map(height)) : 0;
}

/** The list with each group's items rewritten by `fn` (the list itself when `groupId` is null). */
function editGroup(items: FilterItem[], groupId: string | null, fn: (items: FilterItem[]) => FilterItem[]): FilterItem[] {
  if (groupId == null) return fn(items);
  return items.map((item) =>
    !isFilterGroup(item)
      ? item
      : item.id === groupId
        ? { ...item, items: fn(item.items) }
        : { ...item, items: editGroup(item.items, groupId, fn) }
  );
}

/** Groups left empty, at any depth, removed. */
function dropEmpty(items: FilterItem[]): FilterItem[] {
  return items.flatMap((item): FilterItem[] => {
    if (!isFilterGroup(item)) return [item];
    const inner = dropEmpty(item.items);
    return inner.length > 0 ? [{ ...item, items: inner }] : [];
  });
}

export function removeItem(items: FilterItem[], id: string): FilterItem[] {
  const at = locate(items, id);
  if (!at) return items;
  return dropEmpty(editGroup(items, at.parent?.id ?? null, (list) => list.filter((x) => x.id !== id)));
}

/** `item` added at the end of a group (or of the list). */
export function addItem(items: FilterItem[], groupId: string | null, item: FilterItem): FilterItem[] {
  return editGroup(items, groupId, (list) => [...list, item]);
}

export function setGroupMatch(items: FilterItem[], groupId: string | null, match: FilterMatch): FilterItem[] {
  if (groupId == null) return items;
  return items.map((item) =>
    !isFilterGroup(item) ? item : item.id === groupId ? { ...item, match } : { ...item, items: setGroupMatch(item.items, groupId, match) }
  );
}

/** Whether item `id` may go into group `groupId` (null: the list): not inside itself, and not too deep. */
export function canMoveInto(items: FilterItem[], id: string, groupId: string | null): boolean {
  const item = findItem(items, id);
  if (!item) return false;
  if (groupId != null && (groupId === id || (isFilterGroup(item) && findItem(item.items, groupId)))) return false;
  return depthOf(items, groupId) + height(item) <= MAX_GROUP_DEPTH;
}

/**
 * Item `id` moved into group `groupId` (null: the list) before what is at
 * `index` there now (its length: to the end). Unchanged if it can't go there.
 */
export function moveItem(items: FilterItem[], id: string, groupId: string | null, index: number): FilterItem[] {
  const from = locate(items, id);
  if (!from || !canMoveInto(items, id, groupId)) return items;
  const item = (from.parent ? from.parent.items : items)[from.index];
  const sameGroup = (from.parent?.id ?? null) === groupId;
  if (sameGroup && (index === from.index || index === from.index + 1)) return items;
  // Taken out first, so a later place in the same group is one less
  const at = sameGroup && index > from.index ? index - 1 : index;
  const without = editGroup(items, from.parent?.id ?? null, (list) => list.filter((x) => x.id !== id));
  return dropEmpty(editGroup(without, groupId, (list) => [...list.slice(0, at), item, ...list.slice(at)]));
}

/**
 * Item `id` put in a group of its own, where it was, ready for more to join it.
 * The group takes the opposite And/Or to the one around it ("A and (B or …)").
 */
export function wrapInGroup(items: FilterItem[], id: string, outer: FilterMatch): FilterItem[] {
  const at = locate(items, id);
  if (!at) return items;
  const parentId = at.parent?.id ?? null;
  const around = at.parent?.match ?? outer;
  if (depthOf(items, parentId) + 1 + height(findItem(items, id)!) > MAX_GROUP_DEPTH) return items;
  return editGroup(items, parentId, (list) => list.map((x) => (x.id === id ? newGroup(otherMatch(around), [x]) : x)));
}

/** A group's items put back where the group was. */
export function ungroup(items: FilterItem[], groupId: string): FilterItem[] {
  const at = locate(items, groupId);
  const group = at && (at.parent ? at.parent.items : items)[at.index];
  if (!at || !group || !isFilterGroup(group)) return items;
  return editGroup(items, at.parent?.id ?? null, (list) => list.flatMap((x) => (x.id === groupId && isFilterGroup(x) ? x.items : [x])));
}

/** A copy of the item (new ids throughout) just after it. */
export function duplicateItem(items: FilterItem[], id: string): FilterItem[] {
  const at = locate(items, id);
  if (!at) return items;
  const copy = (item: FilterItem): FilterItem => (isFilterGroup(item) ? { ...item, id: newId(), items: item.items.map(copy) } : { ...item, id: newId() });
  return editGroup(items, at.parent?.id ?? null, (list) => list.flatMap((x): FilterItem[] => (x.id === id ? [x, copy(x)] : [x])));
}

/** Every item with fresh ids (copying filters into a rule, so they're its own). */
export function withFreshIds(items: FilterItem[]): FilterItem[] {
  return items.map((item) => (isFilterGroup(item) ? { ...item, id: newId(), items: withFreshIds(item.items) } : { ...item, id: newId() }));
}

// ── Stored form ──────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A stored filter list: filters and groups, anything unreadable left out. */
export function parseFilterItems(raw: unknown): FilterItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: FilterItem[] = [];
  for (const x of raw) {
    if (!isObject(x)) continue;
    if (Array.isArray(x.items)) {
      const items = parseFilterItems(x.items) ?? [];
      if (items.length > 0) out.push({ id: String(x.id ?? newId()), match: x.match === "any" ? "any" : "all", items });
    } else if (typeof x.column === "string" && typeof x.op === "string") {
      out.push(x as unknown as FilterRule);
    }
  }
  return out;
}

/** The list as stored: keys in a fixed order, so equal lists compare equal as text. */
export function serializeFilterItems(items: FilterItem[]): FilterItem[] {
  return items.map((f) =>
    isFilterGroup(f)
      ? { id: f.id, match: f.match, items: serializeFilterItems(f.items) }
      : f.item
        ? { id: f.id, column: f.column, op: f.op, value: f.value, item: f.item }
        : { id: f.id, column: f.column, op: f.op, value: f.value }
  );
}
