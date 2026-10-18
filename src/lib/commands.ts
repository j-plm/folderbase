import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CreateFolderResult,
  DbFilter,
  FileRecord,
  FolderEntry,
  PathSegmentMeta,
  Property,
  PropertyScope,
  PropertyValue,
  QueryResult,
  View,
  ViewNode,
} from "../types";
import type { RuleWrite, StoredRule } from "./rules";

export interface Location {
  location_id: string;
  name: string;
  root_path: string;
  library: string;
  added_at: string;
  last_indexed: string | null;
}

export async function pickDirectory(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  if (Array.isArray(result)) return result[0] ?? null;
  return result ?? null;
}

export async function getLibraries(): Promise<string[]> {
  return invoke<string[]>("get_libraries");
}

export async function ingestDirectory(
  locationIdOrPath: string,
  library?: string
): Promise<number> {
  if (library !== undefined) {
    // Legacy two-arg form: create a location record first, then ingest
    const location = await invoke<Location>("add_location", {
      rootPath: locationIdOrPath,
      name: library,
    });
    await invoke<void>("ingest_directory", { locationId: location.location_id });
    return 0;
  }
  await invoke<void>("ingest_directory", { locationId: locationIdOrPath });
  return 0;
}

export async function getFiles(
  library?: string,
  locationId?: string
): Promise<FileRecord[]> {
  return invoke<FileRecord[]>("get_files", { library, locationId });
}

export async function getLocations(): Promise<Location[]> {
  return invoke<Location[]>("get_locations");
}

/** Adds a location; `excluded` folders (absolute paths inside it) are never scanned. */
export async function addLocation(
  rootPath: string,
  name: string,
  excluded: string[] = []
): Promise<Location> {
  return invoke<Location>("add_location", { rootPath, name, excluded });
}

export interface Subfolder {
  name: string;
  path: string;
}

/** The visible folders directly inside `path`. Reads only the listing, so cloud folders download nothing. */
export async function listSubfolders(path: string): Promise<Subfolder[]> {
  return invoke<Subfolder[]>("list_subfolders", { path });
}

export async function deleteLocation(locationId: string): Promise<void> {
  return invoke<void>("delete_location", { locationId });
}

export async function getProperties(library?: string): Promise<Property[]> {
  return invoke<Property[]>("get_properties", { library });
}

export async function getPropertyValues(
  propertyId: string
): Promise<PropertyValue[]> {
  return invoke<PropertyValue[]>("get_property_values", { propertyId });
}

export async function createProperty(
  name: string,
  library: string | null,
  valueType: string,
  config: string | null = null
): Promise<Property> {
  return invoke<Property>("create_property", {
    name,
    library,
    valueType,
    config,
  });
}

/** The library's rules, in order. */
export async function getRules(library: string): Promise<StoredRule[]> {
  return invoke<StoredRule[]>("get_rules", { library });
}

/** Creates (empty rule_id) or updates a rule; returns it as stored. */
export async function saveRule(rule: StoredRule): Promise<StoredRule> {
  return invoke<StoredRule>("save_rule", { rule });
}

/** Deletes a rule (the values it wrote stay). */
export async function deleteRule(ruleId: string): Promise<void> {
  return invoke<void>("delete_rule", { ruleId });
}

export async function reorderRules(ruleIds: string[]): Promise<void> {
  return invoke<void>("reorder_rules", { ruleIds });
}

/** Every value the library's rules have written (so hand edits stick). */
export async function getRuleWrites(library: string): Promise<RuleWrite[]> {
  return invoke<RuleWrite[]>("get_rule_writes", { library });
}

/** Writes a rule run's values and records them as the rules'. */
export async function applyRuleWrites(edits: CellEdit[], writes: RuleWrite[]): Promise<void> {
  return invoke<void>("apply_rule_writes", { edits, writes });
}

/** Forgets recorded writes (undoing Apply Now). */
export async function forgetRuleWrites(writes: RuleWrite[]): Promise<void> {
  return invoke<void>("forget_rule_writes", { writes });
}

/** Every scoped property's conditions in a library (and global ones). */
export async function getPropertyScopes(library: string | null): Promise<PropertyScope[]> {
  return invoke<PropertyScope[]>("get_property_scopes", { library });
}

/** Replaces a property's conditions (any of them); an empty list makes it apply to every file. Refuses cycles. */
export async function setPropertyScope(
  propertyId: string,
  conditions: { property_id: string; value: string }[]
): Promise<void> {
  return invoke<void>("set_property_scope", { propertyId, conditions });
}

/** Changes the type (and options), converting the values files already hold. */
export async function updatePropertyType(
  propertyId: string,
  valueType: string,
  config: string | null = null
): Promise<void> {
  return invoke<void>("update_property_type", { propertyId, valueType, config });
}

/** Renames a property and moves its values to the new key. */
export async function renameProperty(propertyId: string, name: string): Promise<Property> {
  return invoke<Property>("rename_property", { propertyId, name });
}

export interface CellEdit {
  file_id: string;
  key: string;
  /** null removes the value. */
  value: unknown;
}

/** Writes many metadata cells in one transaction; registers new list values. */
export async function setMetadataCells(edits: CellEdit[]): Promise<void> {
  return invoke<void>("set_metadata_cells", { edits });
}

export async function createPropertyValue(
  propertyId: string,
  value: string
): Promise<PropertyValue> {
  return invoke<PropertyValue>("create_property_value", { propertyId, value });
}

/**
 * Renames a Select / Multi-select value in the registry and every file (merging
 * into `to` if it exists). Folders mapped to it keep mapping to the new name.
 */
export async function renamePropertyValue(propertyId: string, from: string, to: string): Promise<void> {
  return invoke<void>("rename_property_value", { propertyId, from, to });
}

/**
 * Moves a list value from one property to another on every file in the location
 * (remapping folders that give it that value). `overwrite` replaces a Select's
 * existing values.
 */
export async function movePropertyValue(
  locationId: string,
  value: string,
  from: string,
  to: string,
  overwrite = false
): Promise<void> {
  return invoke<void>("move_property_value", { locationId, value, from, to, overwrite });
}

export async function deletePropertyValue(valueId: string): Promise<void> {
  return invoke<void>("delete_property_value", { valueId });
}

export async function deleteProperty(propertyId: string): Promise<void> {
  return invoke<void>("delete_property", { propertyId });
}

export async function updateFileMetadata(
  fileId: string,
  key: string,
  value: unknown
): Promise<void> {
  return invoke<void>("update_file_metadata", { fileId, key, value });
}

export async function getViews(): Promise<View[]> {
  return invoke<View[]>("get_views");
}

export async function createView(
  name: string,
  library: string | null
): Promise<View> {
  return invoke<View>("create_view", { name, library });
}

export async function renameView(viewId: string, name: string): Promise<void> {
  return invoke<void>("rename_view", { viewId, name });
}

export async function deleteView(viewId: string): Promise<void> {
  return invoke<void>("delete_view", { viewId });
}

export async function getViewNodes(viewId: string): Promise<ViewNode[]> {
  return invoke<ViewNode[]>("get_view_nodes", { viewId });
}

export async function createViewNode(
  viewId: string,
  parentNodeId: string | null,
  propertyId: string,
  forkValue: string | null,
  sortOrder: number
): Promise<ViewNode> {
  return invoke<ViewNode>("create_view_node", {
    viewId,
    parentNodeId,
    propertyId,
    forkValue,
    sortOrder,
  });
}

export async function updateViewNode(
  nodeId: string,
  propertyId: string,
  forkValue: string | null
): Promise<void> {
  return invoke<void>("update_view_node", { nodeId, propertyId, forkValue });
}

export async function deleteViewNode(nodeId: string): Promise<void> {
  return invoke<void>("delete_view_node", { nodeId });
}

export async function reorderViewNodes(
  updates: Array<{ nodeId: string; sortOrder: number }>
): Promise<void> {
  return invoke<void>("reorder_view_nodes", { updates });
}

export async function queryVirtualFolder(
  viewId: string,
  path: string[]
): Promise<QueryResult> {
  return invoke<QueryResult>("query_virtual_folder", { viewId, path });
}

export function isFolderResult(
  result: QueryResult
): result is { type: "Folders"; data: FolderEntry[] } {
  return result.type === "Folders";
}

export function isFileResult(
  result: QueryResult
): result is { type: "Files"; data: FileRecord[] } {
  return result.type === "Files";
}

export async function addFile(
  path: string,
  library: string
): Promise<FileRecord> {
  return invoke<FileRecord>("add_file", { path, library });
}

export async function setFileMetadataBatch(
  fileId: string,
  entries: Record<string, unknown>
): Promise<void> {
  return invoke<void>("set_file_metadata_batch", { fileId, entries });
}

export async function getPathMetadata(
  viewId: string,
  path: string[]
): Promise<PathSegmentMeta[]> {
  return invoke<PathSegmentMeta[]>("get_path_metadata", { viewId, path });
}

export async function createVirtualFolder(
  viewId: string,
  path: string[],
  name: string
): Promise<CreateFolderResult> {
  return invoke<CreateFolderResult>("create_virtual_folder", {
    viewId,
    path,
    name,
  });
}

export async function queryLibraryFiles(
  library: string,
  filters: DbFilter[],
  sortCol?: string,
  sortDir?: "asc" | "desc"
): Promise<FileRecord[]> {
  return invoke<FileRecord[]>("query_library_files", {
    library,
    filters,
    sortCol: sortCol ?? null,
    sortDir: sortDir ?? null,
  });
}

export async function getAllPropertyValues(
  library: string
): Promise<PropertyValue[]> {
  return invoke<PropertyValue[]>("get_all_property_values", { library });
}

export async function setFileMetadataArrayAdd(
  fileId: string,
  key: string,
  value: string
): Promise<void> {
  return invoke<void>("set_file_metadata_array_add", { fileId, key, value });
}

export async function setFileMetadataArrayRemove(
  fileId: string,
  key: string,
  value: string
): Promise<void> {
  return invoke<void>("set_file_metadata_array_remove", { fileId, key, value });
}

export async function getIncompleteFiles(
  viewId: string
): Promise<FileRecord[]> {
  return invoke<FileRecord[]>("get_incomplete_files", { viewId });
}

export async function pickFiles(): Promise<string[]> {
  const result = await open({ directory: false, multiple: true });
  if (!result) return [];
  if (Array.isArray(result)) return result as string[];
  return [result as string];
}

export async function clearDatabase(): Promise<void> {
  return invoke<void>("clear_database");
}

export async function getFilesForLocation(
  locationId: string
): Promise<FileRecord[]> {
  return invoke<FileRecord[]>("get_files_for_location", { locationId });
}

export async function openPath(path: string): Promise<void> {
  return invoke<void>("open_path", { path });
}

/** Trackpad haptic (macOS Force Touch); silently does nothing elsewhere. */
export function hapticFeedback(pattern: "alignment" | "levelChange"): void {
  invoke<void>("haptic_feedback", { pattern }).catch(() => {});
}

/** Opens several files together, the way Finder opens a multiple selection. */
export async function openPaths(paths: string[]): Promise<void> {
  return invoke<void>("open_paths", { paths });
}

export interface PathMappingNode {
  node_id: string;
  location_id: string;
  folder_path: string;
  property_name: string;
  depth: number;
}

export interface FolderTreeNode {
  folder_path: string;
  folder_name: string;
  depth: number;
  file_count: number;
  children: FolderTreeNode[];
  mapping: PathMappingNode | null;
  /** Left out of the location: not scanned, its files not indexed. */
  excluded: boolean;
}

export async function getFolderTree(locationId: string): Promise<FolderTreeNode> {
  return invoke<FolderTreeNode>("get_folder_tree", { locationId });
}

export async function setFolderLabel(
  locationId: string,
  folderPath: string,
  propertyName: string
): Promise<void> {
  return invoke<void>("set_folder_label", { locationId, folderPath, propertyName });
}

export async function clearFolderLabel(
  locationId: string,
  folderPath: string
): Promise<void> {
  return invoke<void>("clear_folder_label", { locationId, folderPath });
}

/** Maps several folders to one property. `overwrite` replaces other values a Select already holds. */
export async function setFolderLabels(
  locationId: string,
  folderPaths: string[],
  propertyName: string,
  overwrite = false
): Promise<void> {
  return invoke<void>("set_folder_labels", { locationId, folderPaths, propertyName, overwrite });
}

export async function clearFolderLabels(locationId: string, folderPaths: string[]): Promise<void> {
  return invoke<void>("clear_folder_labels", { locationId, folderPaths });
}

/** Every folder in the location with this name, at any depth: the folders a source tag stands for. */
export async function foldersNamed(locationId: string, name: string): Promise<string[]> {
  return invoke<string[]>("folders_named", { locationId, name });
}

/** Files under these folders whose Select value mapping would replace (0 for a Multi-select). */
export async function countMappingConflicts(
  locationId: string,
  folderPaths: string[],
  propertyName: string
): Promise<number> {
  return invoke<number>("count_mapping_conflicts", { locationId, folderPaths, propertyName });
}

/** Leaves a folder out of its location (its records are removed; nothing on disk changes). Returns how many were removed. */
export async function excludeFolder(locationId: string, folderPath: string): Promise<number> {
  return invoke<number>("exclude_folder", { locationId, folderPath });
}

/** Puts an excluded folder back; its files are indexed on the next refresh. */
export async function includeFolder(locationId: string, folderPath: string): Promise<void> {
  return invoke<void>("include_folder", { locationId, folderPath });
}

export async function getMappingNodes(locationId: string): Promise<PathMappingNode[]> {
  return invoke<PathMappingNode[]>("get_mapping_nodes", { locationId });
}

export async function getLocationProperties(locationId: string): Promise<string[]> {
  return invoke<string[]>("get_location_properties", { locationId });
}

/** Native OS icon for a folder ("folder") or a file extension, as a PNG data URL. */
export async function getNativeIcon(kind: string, size: number): Promise<string> {
  return invoke<string>("get_native_icon", { kind, size });
}

/** Names the changes Edit ▸ Undo / Redo act on ("Undo Paste"); null for plain "Undo". */
export async function setEditMenuLabels(undo: string | null, redo: string | null): Promise<void> {
  return invoke<void>("set_edit_menu_labels", { undo, redo });
}

/** A cached Quick Look thumbnail (PNG path) for a file, or null when there isn't one. */
export async function getThumbnail(path: string, size: number, scale: number): Promise<string | null> {
  return invoke<string | null>("get_thumbnail", { path, size, scale });
}
