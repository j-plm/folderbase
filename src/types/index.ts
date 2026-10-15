export interface FileRecord {
  file_id: string;
  file_path: string;
  file_type: string | null;
  timestamp: string | null;
  library: string | null;
  /** Parsed JSON object when returned from queryVirtualFolder; string when from getFiles. */
  metadata: Record<string, unknown> | null;
  location_id?: string | null;
  relative_path?: string | null;
  file_size?: number | null;
  modified_at?: string | null;
  tags: string[];
}

export interface PathSegmentMeta {
  property_name: string;
  value: string;
}

export interface CreateFolderResult {
  property_name: string;
  value_created: boolean;
}

export interface ViewProps {
  result: QueryResult | null;
  loading: boolean;
  library: string | null;
  onNavigate: (segment: string) => void;
  onAddFiles: (paths: string[]) => Promise<void>;
  onFolderCreated: () => void;
  onNoLayerAtDepth: () => void;
}

export interface Property {
  property_id: string;
  name: string;
  library: string | null;
  value_type: ValueType;
  /** JSON type options; see PropertyConfig. */
  config?: string | null;
}

/** Text, Number, Date, Dropdown, Multi-select (registry names kept from the spec). */
export type ValueType = "free_text" | "number" | "date" | "enum" | "array";

export type NumberFormat = "generic" | "currency" | "percent";

export interface PropertyConfig {
  format?: NumberFormat;
  /** ISO 4217 code, for the currency format. */
  currency?: string;
}

export interface PropertyValue {
  value_id: string;
  property_id: string;
  value: string;
}

export interface View {
  view_id: string;
  name: string;
  library: string | null;
  created_at: string;
  updated_at: string;
}

export interface ViewNode {
  node_id: string;
  view_id: string;
  parent_node_id: string | null;
  property_id: string;
  property_name: string;
  fork_value: string | null;
  sort_order: number;
}

export interface FolderEntry {
  name: string;
  file_count: number;
  has_children: boolean;
}

export type QueryResult =
  | { type: "Folders"; data: FolderEntry[] }
  | { type: "Files"; data: FileRecord[] };

export interface DbFilter {
  property: string;
  value: string;
}

export type DbPreset = "path" | "library" | "incomplete";
