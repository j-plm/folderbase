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
  /** A cloud file not downloaded to this device; its contents are never read, so it stays that way. */
  online_only?: boolean;
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

/** Text, Number, Date, Select, Multi-select (registry names kept from the spec). */
export type ValueType = "free_text" | "number" | "date" | "enum" | "array";

export type NumberFormat = "generic" | "currency" | "percent";

export interface PropertyConfig {
  format?: NumberFormat;
  /** ISO 4217 code, for the currency format. */
  currency?: string;
  /**
   * How a Date property shows its dates: "short", "medium" (the default),
   * "long", "full", "iso", "relative", or "custom:<pattern>" (DD/MM/YYYY…).
   * Dates are stored as YYYY-MM-DD, or YYYY-MM-DDTHH:MM:SS with a time.
   */
  dateFormat?: string;
  /** A Date property showing its dates without the times they have (Show Time off). */
  hideTime?: boolean;
  /** Marks the library's built-in Tags property (renamable, not deletable, always Multi-select). */
  system?: "tags";
}

/** One condition on a scoped property: it applies where `condition_property_id` holds `value`. */
export interface PropertyScope {
  property_id: string;
  condition_property_id: string;
  value: string;
}

export interface PropertyValue {
  value_id: string;
  property_id: string;
  value: string;
  /** Folder names mapped to this value after it was renamed ("01 Apollo" for "Apollo"). */
  sources?: string[];
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
