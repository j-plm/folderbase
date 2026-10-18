import { KIND_BY_TYPE, NATIVE_KINDS, PROP_PREFIX, metaValue, nativeValue, propName } from "./fileColumns";
import { parseConfig, listValues } from "./propertyTypes";
import { impliedValues, scopesByName } from "./scopes";
import { writeKeys, type RuleEnv, type RuleWrite } from "./rules";
import type { FileRecord, Property, PropertyScope } from "../types";

/**
 * How rules read files outside the database view: the same columns, kinds and
 * implied values the table and its filters use.
 */
export function ruleEnv(registry: Property[], scopeRows: PropertyScope[], writes: RuleWrite[], library: string | null): RuleEnv {
  const byName = new Map<string, Property>();
  for (const p of registry) if (!byName.has(p.name) || p.library === library) byName.set(p.name, p);
  const typeOf = (name: string) => byName.get(name)?.value_type ?? null;
  const nameById = new Map(registry.map((p) => [p.property_id, p.name]));
  const scopes = scopesByName(scopeRows, (id) => nameById.get(id));
  const implied = new Map<string, Record<string, string[]>>();
  const impliedFor = (f: FileRecord) => {
    let v = implied.get(f.file_id);
    if (!v) {
      v = impliedValues(f.metadata as Record<string, unknown> | null, scopes, (n) => typeOf(n) === "array");
      implied.set(f.file_id, v);
    }
    return v;
  };
  return {
    valueOf: (file, column) => {
      if (!column.startsWith(PROP_PREFIX)) return nativeValue(file, column);
      const name = propName(column);
      const value = metaValue(file, name);
      const extra = scopes.length > 0 ? impliedFor(file)[name] : undefined;
      return extra ? [...listValues(value), ...extra] : value;
    },
    kindOf: (column) =>
      column.startsWith(PROP_PREFIX) ? KIND_BY_TYPE[typeOf(propName(column)) ?? "free_text"] : (NATIVE_KINDS[column] ?? "text"),
    typeOf,
    configOf: (name) => parseConfig(byName.get(name)),
    written: writeKeys(writes),
  };
}
