# Folderbase — Codebase Reference

## Architecture

Tauri v2 desktop app. Rust backend exposes commands via `invoke()`; React 18 + TypeScript frontend renders them. SQLite (via `sqlx` / `tauri-plugin-sql`) is the single source of truth. Files on disk are never moved — all organisation is metadata in the DB.

---

## Database Schema

Five tables, all PKs are TEXT UUIDs. Migrations run on startup in `src-tauri/src/db/mod.rs`.

| Table | Purpose |
|---|---|
| `files` | One row per file. `file_path` unique. `metadata` is a JSON blob. |
| `properties` | Named metadata dimensions (e.g. `year`, `extension`). Scoped to a `library` or global (`library IS NULL`). `value_type`: `enum`, `free_text`, `array`, `date`. |
| `property_values` | Registered values for a property (the enum registry). |
| `views` | Named virtual folder configurations. Has a `library` FK (nullable). |
| `view_nodes` | Tree of property layers inside a view. `parent_node_id` is self-referential. `fork_value` makes a branch only apply when the parent resolved to that value. |

### Core column names (used in queries as columns, not JSON)
`library`, `file_type`, `timestamp` — everything else is queried via `json_extract(metadata, '$.key')`.

---

## Key Concepts

### Libraries
A library is just a string name on `files.library`. `get_libraries` returns `DISTINCT library` values. Properties are scoped per-library. Views are associated with a library.

### Virtual folders (`query_virtual_folder`)
Traverses the `view_nodes` tree for a view. At each path segment it adds a `(property_name = value)` constraint. At the leaf it calls `fetch_files`; at intermediate nodes it calls `enumerate_folders` (GROUP BY the next property). Forked nodes (`fork_value IS NOT NULL`) are only active when the previous segment matched their fork value.

**Gotcha:** `query_virtual_folder` does NOT filter by `views.library`. It uses view node properties (which are library-scoped) but the underlying SQL queries all files. The Database view (`query_library_files`) does filter by library explicitly.

### Incomplete files (`get_incomplete_files`)
Walks every root-to-leaf path in the view tree. A file is "incomplete" if it has all properties set up to depth K but is missing the property at depth K+1. Returns only files in the view's library.

---

## Rust Command Surface

All commands live in `src-tauri/src/commands/`, registered in `main.rs`.

**`files.rs`**
- `get_libraries` — distinct library names from files table
- `get_files(library?)` — all files, optionally filtered by library
- `add_file(path, library)` — ingest single file with metadata extraction
- `update_file_metadata(file_id, key, value)` — json_set on metadata blob
- `set_file_metadata_batch(file_id, entries)` — json_patch merge
- `set_file_metadata_array_add/remove` — mutate array-valued metadata keys

**`ingest.rs`**
- `ingest_directory(path, library)` — WalkDir, extracts metadata + EXIF, INSERT OR IGNORE, then `bootstrap_properties` (creates property records for every metadata key seen)
- `extract_file_data(path)` — shared helper returning `(file_type, timestamp, metadata_map)`

**`properties.rs`**
- CRUD for `properties` and `property_values`
- `delete_property_value` / `delete_property` cascade-scrub matching values from all file metadata in the library

**`views.rs`**
- CRUD for `views` and `view_nodes`
- `reorder_view_nodes` — batch sort_order update in a transaction

**`virtual_folder.rs`**
- `query_virtual_folder(view_id, path)` — main virtual navigation query
- `get_path_metadata(view_id, path)` — returns `[(property_name, value)]` for each path segment (used when adding a file to set its metadata automatically)
- `create_virtual_folder(view_id, path, name)` — inserts a new `property_value` at the correct depth

**`database_view.rs`**
- `query_library_files(library, filters, sort_col, sort_dir)` — flat file list with optional metadata filters and sort; always scoped to library
- `get_all_property_values(library)` — all values for properties in this library or global
- `get_incomplete_files(view_id)` — files that are partially but not fully classified

---

## Frontend Structure

```
src/
  App.tsx                  # Loads libraries; shows Welcome or AppShell
  contexts/
    NavigationContext.tsx  # Global nav state via useReducer: activeViewId, path,
                           # viewMode, views, viewNodes, editStructure
  components/shell/
    AppShell.tsx           # Layout: IconRail + Sidebar + Toolbar + MainPane
    IconRail.tsx           # View switcher (one button per view) + add view
    Sidebar.tsx            # Placeholder (starred, recents)
    Toolbar.tsx            # Breadcrumb + view mode tabs + Edit Structure + Import Folder
    MainPane.tsx           # Renders active view component; handles drag-drop file add
    Breadcrumb.tsx         # Path display with clickable segments
    Welcome.tsx            # First-run: pick folder → ingest → enter app
    ImportFolderModal.tsx  # In-app folder import; creates view + switches to it on success
  components/views/
    TilesView.tsx          # Grid of folder/file tiles
    ListView.tsx           # Compact list
    ColumnsView.tsx        # Miller-columns navigation
    DatabaseView.tsx       # Spreadsheet; uses useDatabaseView, not useVirtualFolder
    db/                    # ColumnHeader, FilterBar, MetadataCell, PresetBar subcomponents
    shared/PlusRow.tsx     # Inline "create folder" input
  components/editor/
    LocalViewEditor.tsx    # Per-view structure editor (slide-in panel)
    MasterViewEditor.tsx   # Cross-view property/view manager (modal overlay)
    ViewTree.tsx           # Recursive tree of ViewNode rows
    TreeNode.tsx           # Single node row with property picker
    PropertyPicker.tsx     # Dropdown to select a property for a node
  lib/
    commands.ts            # All invoke() calls — sole frontend/backend boundary
    platform.ts            # Platform labels
    fileIcons.tsx          # MIME → icon mapping
  hooks/
    useVirtualFolder.ts    # Drives Tiles/List/Columns: calls query_virtual_folder
    useDatabaseView.ts     # Drives DatabaseView: calls query_library_files + filters
    useDragDrop.ts         # File drag-drop onto a view
```

### NavigationContext fields
`activeViewId`, `path` (string[]), `viewMode`, `views`, `viewNodes`, `editStructure`, `masterEditorOpen`, `currentLibrary` (derived from active view's library).

### View modes
`tiles` | `list` | `columns` use `useVirtualFolder` → `query_virtual_folder`.  
`database` uses `useDatabaseView` → `query_library_files` (always library-scoped, with filters/sort).

---

## Data Flow: Adding Files

1. **Ingest directory** — `ingest_directory` walks disk, inserts into `files`, calls `bootstrap_properties` to create property rows for all metadata keys seen.
2. **Add single file** — `add_file` used when dropping files onto a view. `get_path_metadata` returns the current path's `(property, value)` pairs; `set_file_metadata_batch` stamps those onto the new file.

## Data Flow: Virtual Navigation

```
useVirtualFolder(viewId, path)
  → query_virtual_folder(viewId, path)        [Rust]
      → load view_nodes for viewId
      → walk path: build constraints list
      → if at leaf: SELECT files WHERE <constraints>
      → else:       GROUP BY next_property WHERE <constraints>
  → QueryResult::Files | QueryResult::Folders
```

---

## Testing

- Rust unit tests: `#[cfg(test)]` in same file, `cargo test`
- DB integration tests: `src-tauri/tests/`, use `SqlitePool::connect(":memory:")` + `run_migrations`
- Frontend: Vitest for `src/lib/` utilities; component testing deferred
- Fixture files: `src-tauri/tests/fixtures/` (images with EXIF, PDF, text)
