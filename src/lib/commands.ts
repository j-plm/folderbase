import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CreateFolderResult,
  DbFilter,
  FileRecord,
  FolderEntry,
  PathSegmentMeta,
  Property,
  PropertyValue,
  QueryResult,
  View,
  ViewNode,
} from "../types";

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

export async function addLocation(
  rootPath: string,
  name: string
): Promise<Location> {
  return invoke<Location>("add_location", { rootPath, name });
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
  valueType: string
): Promise<Property> {
  return invoke<Property>("create_property", {
    name,
    library,
    valueType,
  });
}

export async function updatePropertyType(
  propertyId: string,
  valueType: string
): Promise<void> {
  return invoke<void>("update_property_type", { propertyId, valueType });
}

export async function createPropertyValue(
  propertyId: string,
  value: string
): Promise<PropertyValue> {
  return invoke<PropertyValue>("create_property_value", { propertyId, value });
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
