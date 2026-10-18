import { listValues } from "./propertyTypes";
import type { PropertyScope } from "../types";

// Scoped properties: a property applies only where another property holds one
// of its condition values (any of them). Pure, by property name, so the
// database view can use it on its rows. See the spec: "Tags, Properties and
// Scoped Properties".

export interface ScopeCondition {
  property: string;
  value: string;
}

export interface Scope {
  property: string;
  conditions: ScopeCondition[];
}

type Meta = Record<string, unknown> | null | undefined;

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
const hasValue = (list: string[], value: string) => list.some((v) => same(v, value));

/** The registry's rows (by property id) as scopes by property name; conditions on unknown properties are dropped. */
export function scopesByName(rows: PropertyScope[], nameOf: (propertyId: string) => string | undefined): Scope[] {
  const byProperty = new Map<string, ScopeCondition[]>();
  for (const row of rows) {
    const property = nameOf(row.property_id);
    const condition = nameOf(row.condition_property_id);
    if (!property || !condition) continue;
    const list = byProperty.get(property) ?? [];
    list.push({ property: condition, value: row.value });
    byProperty.set(property, list);
  }
  return [...byProperty.entries()].map(([property, conditions]) => ({ property, conditions }));
}

/**
 * Values a file holds only by implication: a value in a scoped property
 * implies its condition (Housing = Rent implies Tags has `housing`), through
 * chains of scopes. Only a single-condition scope implies anything (with
 * several, which one holds is unknown), and only into a list property or an
 * empty single-value one. Returns just the added values, by property.
 */
export function impliedValues(meta: Meta, scopes: Scope[], isList: (property: string) => boolean): Record<string, string[]> {
  const effective = new Map<string, string[]>();
  const get = (p: string) => effective.get(p) ?? listValues(meta?.[p]);
  const added: Record<string, string[]> = {};
  let changed = true;
  // Scopes can't form cycles, so this settles within one pass per link in the longest chain
  for (let pass = 0; changed && pass <= scopes.length; pass++) {
    changed = false;
    for (const scope of scopes) {
      if (scope.conditions.length !== 1 || get(scope.property).length === 0) continue;
      const { property, value } = scope.conditions[0];
      const current = get(property);
      if (hasValue(current, value)) continue;
      if (!isList(property) && current.length > 0) continue;
      effective.set(property, [...current, value]);
      (added[property] ??= []).push(value);
      changed = true;
    }
  }
  return added;
}

/** A property's values, stored and implied. */
export function effectiveValues(meta: Meta, implied: Record<string, string[]>, property: string): string[] {
  return [...listValues(meta?.[property]), ...(implied[property] ?? [])];
}

/** Whether a scope's property applies to a file: any condition holds (stored or implied). */
export function applies(scope: Scope | undefined, meta: Meta, implied: Record<string, string[]>): boolean {
  if (!scope || scope.conditions.length === 0) return true;
  return scope.conditions.some((c) => hasValue(effectiveValues(meta, implied, c.property), c.value));
}

/**
 * A scoped property's cell: it has a value; it's expected (applies, but has
 * none yet); or it doesn't apply.
 */
export function scopeState(
  scope: Scope | undefined,
  meta: Meta,
  implied: Record<string, string[]>
): "value" | "expected" | "na" {
  if (!scope) return "value";
  if (listValues(meta?.[scope.property]).length > 0) return "value";
  return applies(scope, meta, implied) ? "expected" : "na";
}

/**
 * Removing `removed` from `property` on a file: the scoped properties that
 * lose their condition and must be cleared, and then any scoped to those, in
 * order. A property keeps its value if another of its conditions still holds
 * in the file's stored values.
 */
export function propertiesToClear(meta: Meta, scopes: Scope[], property: string, removed: string[]): string[] {
  const stored = new Map<string, string[]>();
  const get = (p: string) => stored.get(p) ?? listValues(meta?.[p]);
  stored.set(property, get(property).filter((v) => !hasValue(removed, v)));
  const queue: ScopeCondition[] = removed.map((value) => ({ property, value }));
  const cleared: string[] = [];
  while (queue.length > 0) {
    const gone = queue.shift()!;
    for (const scope of scopes) {
      if (cleared.includes(scope.property) || get(scope.property).length === 0) continue;
      const dependsOnIt = scope.conditions.some((c) => c.property === gone.property && same(c.value, gone.value));
      if (!dependsOnIt) continue;
      if (scope.conditions.some((c) => hasValue(get(c.property), c.value))) continue;
      cleared.push(scope.property);
      for (const value of get(scope.property)) queue.push({ property: scope.property, value });
      stored.set(scope.property, []);
    }
  }
  return cleared;
}

/** The scoped properties a value opens into (`housing ›`), for a property's pill or, with null, any property's. */
export function opensInto(scopes: Scope[], property: string | null, value: string): string[] {
  return scopes
    .filter((s) => s.conditions.some((c) => (property == null || c.property === property) && same(c.value, value)))
    .map((s) => s.property);
}

/**
 * Where a scoped property comes from, after "‹" in its header. Each condition
 * shows its value, with the property it's in unless that's the usual source
 * (Tags); a value that just repeats the header's own name shows its source
 * instead, so "Car ‹ Car" reads "Car ‹ Tags".
 *
 *   Housing ‹ home        Car ‹ Tags        Insurance Type ‹ Housing: House Insurance
 */
export function scopeOrigin(scope: Scope | undefined, usualSource: string | null = null): string | null {
  if (!scope || scope.conditions.length === 0) return null;
  return scope.conditions
    .map((c) => {
      if (same(c.value, scope.property)) return c.property;
      return c.property === usualSource ? c.value : `${c.property}: ${c.value}`;
    })
    .join(", ");
}

/** "Applies when Tags has housing or car", for a header's tooltip. */
export function describeScope(scope: Scope | undefined): string | null {
  if (!scope || scope.conditions.length === 0) return null;
  const byProperty = new Map<string, string[]>();
  for (const c of scope.conditions) byProperty.set(c.property, [...(byProperty.get(c.property) ?? []), c.value]);
  return (
    "Applies when " +
    [...byProperty.entries()].map(([p, values]) => `${p} has ${values.join(" or ")}`).join(", or ")
  );
}

/** Whether `property` depends on `other`, directly or through a chain of scopes. */
export function dependsOn(scopes: Scope[], property: string, other: string): boolean {
  const seen = new Set<string>();
  const stack = [property];
  while (stack.length > 0) {
    const p = stack.pop()!;
    for (const c of scopes.find((s) => s.property === p)?.conditions ?? []) {
      if (c.property === other) return true;
      if (!seen.has(c.property)) {
        seen.add(c.property);
        stack.push(c.property);
      }
    }
  }
  return false;
}

/** How a scope would split the files: with a value, still to fill in (applies, empty), and not applying. */
export function scopeCoverage(
  metas: Meta[],
  scopes: Scope[],
  property: string,
  conditions: ScopeCondition[],
  isList: (property: string) => boolean
): { withValue: number; expected: number; na: number } {
  const next = [...scopes.filter((s) => s.property !== property), ...(conditions.length ? [{ property, conditions }] : [])];
  const scope = next.find((s) => s.property === property);
  const counts = { withValue: 0, expected: 0, na: 0 };
  for (const meta of metas) {
    // Unscoped, an empty cell is simply still to fill in
    const state = scope
      ? scopeState(scope, meta, impliedValues(meta, next, isList))
      : listValues(meta?.[property]).length > 0
        ? "value"
        : "expected";
    if (state === "value") counts.withValue++;
    else if (state === "expected") counts.expected++;
    else counts.na++;
  }
  return counts;
}
