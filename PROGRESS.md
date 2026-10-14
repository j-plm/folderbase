# Folderbase — Build Progress

**Status: Native macOS look pass (light/dark, Finder colours, native icons, unified title bar); view editor bugs outstanding**

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

- [x] **View editor** — tree editor for configuring views
  - [x] `commands/views.rs` — `get_views`, `get_view_nodes`, `create_view`, `rename_view`, `delete_view` (cascades nodes), `create_view_node`, `update_view_node`, `delete_view_node` (deletes descendants), `reorder_view_nodes` (batch, transactional)
  - [x] 8 integration tests in `tests/view_editor_tests.rs`; 55 total Rust tests passing
  - [x] Shared tree components — `ViewTree`, `TreeNode` (add layer, add fork with branch value, move up/down, delete with confirmation), `PropertyPicker`
  - [x] `LocalViewEditor` — side panel toggled by Edit Structure; "Current level" / "Full tree" scope toggle with current-node highlight; rename view
  - [x] `MasterViewEditor` — full-window overlay from the icon rail; view list with create, rename, duplicate, delete (with confirmation); full tree editor; Escape closes
  - [x] Both editors wired into `AppShell`

- [x] **Native macOS look (pass 1)** — the app should map visually to the host OS file manager (Finder on macOS, File Explorer on Windows)
  - [x] Light + dark appearance — View ▸ Appearance menu (Use System Setting / Light / Dark), default Light, persisted to `appearance` in the app config dir (`src-tauri/src/appearance.rs`, 4 unit tests); window theme drives `prefers-color-scheme`
  - [x] Finder palette — `src/index.css` remaps Tailwind's neutral/gray/blue/red/green/amber scales to Finder colours via CSS variables, inverted in light mode, so existing dark-first class names work in both appearances
  - [x] System font (SF), 13px body (`text-body`), dim greys raised to tertiary-label contrast
  - [x] Unified title bar — `titleBarStyle: Overlay`, hidden title, traffic lights over the sidebar; 52px toolbar draggable across its full width (`data-tauri-drag-region` must be on the clicked element itself, so the title/breadcrumb elements carry it too); current location shown as bold window title
  - [x] Native icons — `get_native_icon` command renders the real macOS icon (NSWorkspace / NSImageNameFolder) as PNG; `FileIcon` / `FolderIcon` in `fileIcons.tsx` cache per kind+size and fall back to SVG on other platforms; used in Tiles, List, Columns, Database and the Map Structure folder browser
  - [x] Finder-style lists — 24px rows, alternating stripes, solid accent selection with white text, plain secondary-colour metadata, sentence-case column headers
  - [x] 63 Rust tests + 10 frontend tests passing
- [x] **Finder-style tables and tiles**
  - [x] `src/lib/columns.ts` — `fitColumnWidths` (fit to width by weight, respecting min widths and user-resized columns), `resizeColumn`, `contentFitWidth`, `toggleSort`, `compareSortValues` (natural order, empties last); 12 Vitest tests
  - [x] `useColumnLayout` hook — measures the scroll container, drag-to-resize dividers (a drag pins every column at its current width, so only the dragged column changes and the table can outgrow the window and scroll), double-click a divider to size that column to its widest content (canvas text measurement via `src/lib/textMeasure.ts`, works with virtualised rows), widths persisted per table in localStorage (`colw-<key>`)
  - [x] Shared `TableHeader` — sticky, click to sort with chevron, resize handles; text never wraps (cells truncate)
  - [x] `FileTable` — List view's Finder-order table (Columns originally shared it; now has its own column browser) (Name, Date Modified, Size, Kind) with sorting, selection, and a "Size All Columns to Fit" header menu. Columns view is still a table placeholder, not Miller columns
  - [x] Database view rebuilt on the same header — single scroll container (replaces header/body scroll sync); every standard column except Name can be hidden (`col-hidden-<locationId>`); right-clicking the header opens a native context menu (`src/lib/nativeMenu.ts`) to toggle columns, Tags and properties, or fit all columns
  - [x] Resizable sidebar — drag its right edge (150–400px), width persisted (`sidebar-width`)
  - [x] Toolbar overflow — `OverflowBar` measures its items with an invisible copy; items that don't fit move, from the end, into a » button that opens a native menu (`src/lib/overflow.ts`, 3 Vitest tests; `nativeMenu.ts` now supports submenus). Used for the view switcher (→ View ▸ as Tiles/List/…) and the Database bar (Map Structure, Re-index, Columns ▸). Search stays visible and shrinks to 120px
  - [x] Database view: drag a header to reorder columns (Name stays first); blue drop indicator; order persisted per location (`col-order-<locationId>`). Helpers `orderColumns`, `moveColumnId`, `dropIndexAt` in `columns.ts` with tests
  - [x] Database Columns button now opens the same native menu as right-clicking the header (HTML popover removed)
  - [x] Sort + Group (Tiles, List, Columns) — `src/lib/arrange.ts` (`sortFiles`, `groupFiles`, `kindCategory`; 7 Vitest tests) and `ArrangementContext` (shared, persisted as `arrangement`). Toolbar group button (hidden in Database view) opens Group By options + Sort By ▸; right-clicking a view's background opens Group By ▸ / Sort By ▸. List header clicks drive the same sort. Groups: Kind (Documents, Images, PDF Documents, Movies, Music, Presentations, Spreadsheets, Developer, Other), Name (0–9, A–Z), Date Modified/Created (Today, Yesterday, Previous 7/30 Days, month, year), Size (ranges, largest first)
  - [x] Finder metrics pass — List/Columns: 20pt rows and 16pt icons (measured from Finder), rounded stripes inset 10px, 28px header, quiet 56px group headings; Finder date ("Today at 05:58", "13 Aug 2026 at 13:07"), decimal sizes ("1.7 MB"), Finder kind names (`formatFinderDate`, `formatFinderSize`, `kindLabel` in `arrange.ts`). Tiles: 106px cells / 9px gap, 15px group headings with separators between groups, two-line labels with middle truncation keeping the extension (`src/lib/tileLabel.ts`, 4 tests). Group button uses Finder's outlined grid glyph
  - [x] Native SF Symbols — `get_native_icon` accepts `symbol:<name>` (NSImage systemSymbolName, aspect-fitted); `SymbolIcon` uses the PNG as a CSS mask over `currentColor` so it takes our text colours. Sidebar locations use the native `folder` symbol; selected item turns accent blue like Finder
  - [x] Native glyphs everywhere — group button (`square.grid.3x2` + `chevron.down`), overflow (`chevron.forward.2`), header sort (`chevron.up/down`), sidebar `plus` are SF Symbols; SVGs kept only as non-macOS fallbacks. Database view now uses Finder's 20pt rows, inset rounded stripes, and Finder date/size formats
  - [x] **Standard adopted: always use the OS defaults** — written into the spec ("Native Fidelity Standard") and CLAUDE.md frontend conventions
  - [x] Database tag pills — 16px tall in the system font (11px) so they sit inside 20pt rows
  - [x] **Columns view rebuilt as Finder column view** (`components/views/columns/ColumnBrowser.tsx`, logic in `src/lib/columnBrowser.ts` with 9 tests): name-only rows (22pt, no stripes/metadata, single-line middle truncation via `middleTruncate`), folders show a chevron and open a new column, files open Finder's preview column, which fills the remaining width with the icon/image scaled to fit (native icon re-rendered in 32pt steps up to 512pt), then name, kind - size, Information with long dates (`formatLongDate`) and Tags; group headings have Finder's 25px gap above and no rule; active-column selection blue, ancestor selections grey; drag a column edge to resize, double-click to fit; new columns inherit the width of the column to their left; root width persisted; arrow-key navigation (↑↓ within a column, → into a folder, ← back, ⌘↓ opens); Sort By / Group By applied per column with folders on top (own "Folders" group when grouping). Takes a generic `BrowserNode` tree — locations currently supply a flat file list, so folders will appear once folder data is passed in
  - [x] Tiles view — fixed 100px cells and fixed gaps (`repeat(auto-fill, 100px)`), so resizing changes how many tiles fit per row, not the spacing; Finder-style selection (grey icon backing, blue label)

---

## Up Next

File opening & previews (one feature — both are about showing/opening file content the native way):
- [ ] Content previews via Quick Look thumbnails (`QLThumbnailGenerator`) instead of type icons: Tiles, List/Columns row icons, and the Columns preview column (first page of PDFs/documents, image thumbnails); render on the Rust side like `get_native_icon`, cached
- [ ] Quick Look panel: Space bar previews the selected file in every view
- [ ] Consistent opening: double-click / ⌘↓ / ⌘O open with the default app in every view (Tiles, List, Columns, Database); Open With submenu; file context menu (Open, Quick Look, Get Info, Show in Finder)
- [ ] Editable "Add Tags…" in the preview column

Native look — next passes:
- [ ] Windows: native icons via `SHGetFileInfo` and a File Explorer palette/layout (currently SVG fallback + mac palette)
- [ ] Sidebar vibrancy (translucent sidebar like Finder) and SF Symbols-style sidebar glyphs
- [ ] Finder-style toolbar controls (back/forward, icon segmented view switcher, search field)
- [ ] Sweep remaining panels/modals (view editors, mapping panel, welcome, filter/preset bars) for native control styles
- [ ] Tiles view selection styling (grey icon backing + blue label pill)

View editor — remaining gaps against the spec and known bugs:
- [ ] **Bug: reordering fails** — `reorderViewNodes` sends `{ nodeId, sortOrder }` but Rust `ReorderItem` expects `node_id` / `sort_order` (nested struct fields aren't auto-converted from camelCase), so ↑/↓ never persists
- [ ] **Bug: duplicating a view can flatten it** — `handleDuplicate` in `MasterViewEditor` only sorts roots first, not parents-before-children, so deeper nodes whose parent hasn't been copied yet get attached at the root. Fix with a topological copy (ideally a single `duplicate_view` Rust command in a transaction, with tests)
- [ ] **Bug: local editor ignores forks** — `findCurrentNodeId` in `LocalViewEditor` always takes the first non-fork child instead of matching path segments to `fork_value`, so "Current level" can show the wrong subtree in forked views
- [ ] Delete node: offer "collapse children up" as well as removing the branch; warn only when files would become unclassified (currently always removes the whole branch with a generic confirmation)
- [ ] Drag to reorder (currently ↑/↓ buttons only)
- [ ] Duplicate view from the local editor (master editor only today)
- [ ] Errors from editor commands are unhandled (no user feedback)

Housekeeping:
- [ ] Delete dead `DatabaseView.tsx` (`MainPane` only renders `LocationDatabaseView`)
- [ ] Add a lint setup — `npm run lint` is referenced in CLAUDE.md but no script exists

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
- `.gitignore` excludes `node_modules/`, `dist/`, `src-tauri/target/`, `.DS_Store`; repo pushed to https://github.com/j-plm/folderbase (2026-10-13)
- `files.metadata` blob is for user-defined and EXIF properties only — filesystem fields (`file_name`, `extension`, `size_bytes`, `created_at`) belong in dedicated columns; `get_location_properties` reads keys from the blob directly, so anything written there surfaces as a user-visible column

---

_Update this file at the end of each working session — tick off completed items, move new tasks into Up Next, and log any decisions made._
