import { useCallback, useEffect, useMemo, useState } from "react";
import { getLocationProperties, getLocations, getProperties, getPropertyScopes, getPropertyValues } from "../../lib/commands";
import { scopesByName } from "../../lib/scopes";
import type { Property, PropertyScope, ValueType } from "../../types";

/**
 * What the hierarchy needs to know about the location's properties:
 * their types and scopes (as the Database view reads them), and which there are.
 */
export function useFolderSource(locationId: string | null) {
  const [library, setLibrary] = useState<string | null>(null);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [registry, setRegistry] = useState<Property[]>([]);
  const [scopeRows, setScopeRows] = useState<PropertyScope[]>([]);
  const [metadataKeys, setMetadataKeys] = useState<string[]>([]);
  /** Registered values of Select and Multi-select properties, by property id. */
  const [registeredValues, setRegisteredValues] = useState<Record<string, string[]>>({});
  /** The location the properties above were read for. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!locationId) return;
    const locations = await getLocations();
    const location = locations.find((l) => l.location_id === locationId);
    const lib = location?.library ?? null;
    const [props, scopes, keys] = await Promise.all([
      lib ? getProperties(lib) : Promise.resolve([]),
      lib ? getPropertyScopes(lib) : Promise.resolve([]),
      getLocationProperties(locationId),
    ]);
    const listed = props.filter((p) => p.value_type === "enum" || p.value_type === "array");
    const values = await Promise.all(listed.map((p) => getPropertyValues(p.property_id).then((vs) => [p.property_id, vs.map((v) => v.value)] as const)));
    setRegisteredValues(Object.fromEntries(values));
    setLibrary(lib);
    setLocationName(location?.name ?? null);
    setRegistry(props);
    setScopeRows(scopes);
    setMetadataKeys(keys);
    setLoadedFor(locationId);
  }, [locationId]);
  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  /** Library-scoped properties win over global ones of the same name. */
  const propByName = useMemo(() => {
    const map = new Map<string, Property>();
    for (const p of registry) {
      if (!map.has(p.name) || p.library != null) map.set(p.name, p);
    }
    return map;
  }, [registry]);
  /** A property's registered values (Select and Multi-select; none for others). */
  const valuesOf = useCallback(
    (name: string): string[] => {
      const id = propByName.get(name)?.property_id;
      return id ? (registeredValues[id] ?? []) : [];
    },
    [propByName, registeredValues]
  );
  const propertyIdOf = useCallback((name: string) => propByName.get(name)?.property_id ?? null, [propByName]);
  const typeOf = useCallback((name: string): ValueType => propByName.get(name)?.value_type ?? "free_text", [propByName]);
  const scopes = useMemo(() => {
    const nameById = new Map(registry.map((p) => [p.property_id, p.name]));
    return scopesByName(scopeRows, (id) => nameById.get(id));
  }, [registry, scopeRows]);
  /** Registered properties and keys found on the location's files, as the Database view offers them. */
  const properties = useMemo(
    () =>
      [...new Set([...metadataKeys, ...registry.map((p) => p.name)])]
        .filter((n) => !n.startsWith("_"))
        .sort((a, b) => a.localeCompare(b)),
    [metadataKeys, registry]
  );

  return { library, locationName, valuesOf, propertyIdOf, typeOf, scopes, properties, reload, loaded: loadedFor === locationId };
}
