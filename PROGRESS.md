# Folderbase — Build Progress

**Status: Metadata blob cleaned up — filesystem fields moved to dedicated columns; LocationDatabaseView polished**

---

## Completed

- [x] Project scaffolded (Tauri v2 + React + TypeScript)
- [x] tauri-plugin-dialog, tauri-plugin-fs added
- [x] Database migration wired up on startup (sqlx inline migrations)
- [x] All five tables created: `files`, `properties`, `property_values`, `views`, `view_nodes`
- [x] Tauri command stubs registered
- [x] App launches cleanly with `cargo tauri dev`
- [x] `CLAUDE.md` written
- [x] **Directory ingestion** — `ingest_directory` command crawls recursively, skips hidden files and symlinks, extracts MIME type, timestamps, and standard metadata JSON, inserts with `INSERT OR IGNORE` (deduplicates by path)
- [x] **EXIF extraction** — for jpg/jpeg/png/tiff/heic files: date_taken, camera_make, camera_model, width, height, iso, focal_length, latitude, longitude
- [x] **Property registry bootstrapping** — after ingestion, auto-creates `properties` + `property_values` rows for all metadata keys found in new records
- [x] **Frontend types** — `src/types/index.ts` mirroring all Rust models
- [x] **commands.ts** — all `invoke()` calls centralised; `pickDirectory()` via tauri-plugin-dialog
- [x] **platform.ts** — platform detection and labels
- [x] **Welcome screen** — first-run import flow with folder picker, library name input, progress indicator, completion transition
- [x] **App routing** — shows Welcome if no libraries exist, transitions to main shell on completion
- [x] Tailwind CSS v4 configured
- [x] **Integration tests** — 5 tests passing via `cargo test`: correct file count, no-duplicate re-ingestion, JPEG EXIF fields present, PNG basic-only metadata, property bootstrapping correctness
- [x] `tests/common/mod.rs` — in-memory DB helper with full migration
- [x] `tests/fixtures/` — sample.jpg (EXIF), sample.png, sample.txt, subdir/nested.txt, .hidden_file
- [x] **Property registry commands** — full CRUD in `commands/properties.rs`: `get_properties`, `get_property_values`, `create_property` (duplicate rejection + value_type validation), `update_property_type`, `create_property_value` (duplicate rejection), `delete_property_value` (+ metadata scrub), `delete_property` (+ metadata scrub)
- [x] **`infer_value_type` utility** — `src-tauri/src/db/utils.rs`: ISO 8601 dates → "date", >20 distinct values → "free_text", otherwise → "enum"; used in bootstrapping pass instead of hardcoded "enum"
- [x] **Registry integration tests** — 10 tests in `tests/registry_tests.rs`; 22 total passing
- [x] **Virtual folder query engine** — `commands/virtual_folder.rs`: `query_virtual_folder_inner` + `query_virtual_folder` Tauri command; handles forking hierarchies, scalar+array JSON properties (CTE union), core columns, `has_children` per folder entry; 8 integration tests in `tests/virtual_folder_integration.rs`; 30 total passing
- [x] **Frontend types** updated — `QueryResult` discriminated union (`type`/`data` serde tags), `FolderEntry`; `commands.ts` has `queryVirtualFolder`, `isFolderResult`, `isFileResult`
- [x] **React UI shell** — `NavigationContext` (reducer + provider + hook), `AppShell`, `IconRail`, `Sidebar`, `Toolbar`, `MainPane`, `Breadcrumb`; placeholder view stubs for Tiles/List/Columns/Database; `PLACEHOLDER_VIEWS` in `placeholders.ts`; App.tsx wrapped in NavigationProvider
- [x] **Frontend tests** — Vitest + Testing Library configured; 4 reducer tests (NavigationContext) + 4 Breadcrumb component tests; 8 frontend tests passing; 30 Rust tests still passing
- [x] **Real views from DB** — `NavigationContext` loads `getViews()` on mount, exposes `views`, `currentLibrary`; `IconRail` and `Toolbar` use live DB views; `PLACEHOLDER_VIEWS` removed from consumers
- [x] **`useVirtualFolder` hook** — fetches `queryVirtualFolder(viewId, path)` with stale-response guard, loading/error states, stable `refetch` callback
- [x] **MainPane data flow** — wires hook into all four view components via `ViewProps`; `onAddFiles` pipeline: `addFile` → `getPathMetadata` → `setFileMetadataBatch` → refetch
- [x] **New Rust commands** — `add_file` (single-file ingestion reusing `extract_file_data` from ingest), `set_file_metadata_batch` (json_patch), `get_path_metadata` (tree walk → property/value pairs), `create_virtual_folder` (adds property value to registry); all registered in `lib.rs`
- [x] **Shared UI utilities** — `src/lib/fileIcons.tsx` (MIME-to-SVG icon, `isImageMime`); `src/components/views/shared/PlusRow.tsx` (inline rename input, tile/row/list-item display variants)
- [x] **`useDragDrop` hook** — registers Tauri v2 `onDragDropEvent` window listener; exposes `isDragging` for overlay feedback
- [x] **TilesView** — responsive grid; folder tiles with count badge; image thumbnails via `convertFileSrc`; file-type icons; drag-over overlay; "+" tile for new virtual folders; loading skeleton
- [x] **ListView** — sticky-header table; folder mode: Name/Items/Subfolders + "+" row; file mode: Name/Type/Date Modified/Size with formatted values
- [x] **ColumnsView (Miller columns)** — parallel column fetches; click-to-navigate updates context path; per-column refetch on folder creation; auto-scroll to rightmost column; drag-drop on terminal column; "+" per folder column
- [x] **Asset protocol** — `tauri.conf.json` enables `assetProtocol`, CSP updated for `img-src asset:`; `protocol-asset` feature added to `Cargo.toml`
- [x] **Tests** — 35 Rust tests + 8 frontend tests all passing; TypeScript compiles clean
- [x] **Database view** — editable metadata table mode
  - [x] `build_constraints_sql` / `is_core` moved to `db/utils.rs` (shared)
  - [x] `NodeRow` + `load_nodes_by_parent` made pub in `virtual_folder.rs`
  - [x] `database_view.rs` — 5 new Tauri commands: `query_library_files` (sort + filter), `get_all_property_values` (bulk, library-scoped), `set_file_metadata_array_add`, `set_file_metadata_array_remove`, `get_incomplete_files` (path-based DFS, handles forking views)
  - [x] 12 new Rust tests in `database_view.rs`; 47 total Rust tests passing
  - [x] `DbFilter` / `DbPreset` types; 5 new commands in `commands.ts`
  - [x] `useDatabaseView` hook — preset switching, filter state, sort, optimistic cell patches
  - [x] `PresetBar`, `FilterBar`, `ColumnHeader`, `MetadataCell` sub-components
  - [x] `DatabaseView.tsx` — table with sticky header, core columns + one column per registered property, inline editing (enum/free_text/array/date), portal dropdowns, "Add value" registry extension, status bar; TypeScript compiles clean
- [x] **Path metadata mapping** — label folder levels to auto-derive file metadata from path structure
  - [x] `path_mapping_nodes` table + `idx_pmn_location` index added to migration
  - [x] `commands/path_mapping.rs` — `PathMappingNode` + `FolderTreeNode` structs; `get_folder_tree` (builds tree from `files.relative_path`, attaches existing labels), `set_folder_label` (upsert + live metadata apply), `clear_folder_label` (removes only path-derived values, not manually set ones), `get_mapping_nodes`; `pub(crate) apply_mapping_to_files` with merge semantics (json_set only where key IS NULL)
  - [x] `ingest.rs` updated — after walk, re-applies all mapping nodes for the location so newly indexed files are auto-classified
  - [x] Four new commands registered in `lib.rs`
  - [x] `commands.ts` — `PathMappingNode` + `FolderTreeNode` interfaces; `getFolderTree`, `setFolderLabel`, `clearFolderLabel`, `getMappingNodes` wrappers
  - [x] `PathMappingPanel.tsx` — 480px slide-in drawer (CSS transition); loads tree + mappings on mount; footer shows file count + labelled-folder count
  - [x] `TreeEditor.tsx` — recursive folder rows; confirmed labels show coloured pill (5 accent colours, deterministically assigned by property name); unconfirmed suggestions shown as dashed-border italic (sibling-first → same-depth fallback); empty state shows placeholder; collapses beyond depth 2 by default; Tab/Enter accepts suggestion, Escape dismisses
  - [x] `LocationDatabaseView.tsx` — "Map Structure" button in header (blue active state when mappings exist); outer div made `relative` for panel overlay; panel opens/closes without disturbing the file list behind it
  - [x] Rust compiles clean; TypeScript compiles clean
- [x] **Metadata blob cleanup** — filesystem-derived fields removed from `files.metadata` JSON blob
  - [x] `file_name`, `extension` removed (always derivable from `file_path`)
  - [x] `size_bytes` removed (duplicate of `files.file_size` column)
  - [x] `created_at` removed from blob; `files.created_at TEXT` column added via migration; `FileRecord` model updated
  - [x] `extract_file_data` return type expanded to `(file_type, timestamp, file_size, created_at, metadata)`; all callers updated (`ingest_location`, `ingest_directory_impl`, `add_file`)
  - [x] Migration step scrubs the four stale keys from existing metadata blobs (`json_remove`) and deletes the spuriously bootstrapped property rows
  - [x] `ingest_tests.rs` updated — PNG test now asserts the four keys are absent from the blob; bootstrapping test asserts they never appear as properties; 55 total tests passing
- [x] **`LocationDatabaseView` column fixes**
  - [x] `visibleProperties` filtered against `availableProperties` on every fetch — stale localStorage entries can no longer render phantom columns
  - [x] `Extension` added as a fixed standard column (derived from `file_path` in JS, rendered as monospace pill)

---

## Up Next
- [ ] View editor — tree editor for configuring views

---

## Decisions & Notes

- Physical files are never moved by virtual folder operations — all organisation is metadata-only
- `files.metadata` is a JSON blob; SQLite JSON functions used for querying
- All primary keys are `TEXT` UUIDs generated in Rust
- Single root `CLAUDE.md` rather than per-directory files — revisit if Rust and frontend contexts grow large
- Replaced `tauri-plugin-sql` with direct `sqlx` pool managed as Tauri state — cleaner for Rust-side commands; all DB access from frontend goes through `invoke()`
- `UNIQUE INDEX` on `files.file_path` enforces deduplication; `INSERT OR IGNORE` silently skips already-ingested files
- Property bootstrapping uses `infer_value_type` heuristic: RFC3339/ISO-8601 values → "date", >20 distinct values → "free_text", otherwise → "enum"
- `DatabaseView.tsx` is dead code — `MainPane` renders `LocationDatabaseView` exclusively; edits to `DatabaseView.tsx` have no effect
- `files.metadata` blob is for user-defined and EXIF properties only — filesystem fields (`file_name`, `extension`, `size_bytes`, `created_at`) belong in dedicated columns; `get_location_properties` reads keys from the blob directly, so anything written there surfaces as a user-visible column

---

_Update this file at the end of each working session — tick off completed items, move new tasks into Up Next, and log any decisions made._
