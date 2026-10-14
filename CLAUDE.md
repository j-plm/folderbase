# Project: Folderbase

A local desktop file management app that decouples physical file storage from logical navigation. Files live on disk; all organisation is handled by a single SQLite database. The UI presents configurable virtual folder views built entirely from database queries — no files ever move when the user navigates or reorganises.

---

## Stack

- Tauri v2 (Rust backend) + React 18 + TypeScript (frontend)
- SQLite via tauri-plugin-sql
- Tailwind CSS

## Key commands

- `cargo tauri dev` — run in development
- `cargo tauri build` — production build
- `cargo test` — run Rust tests
- `npm run lint` — lint frontend

---

## Project structure

```
src/
  components/
    shell/        # Icon rail, sidebar, toolbar, main pane
    views/        # Tiles, List, Columns, Database view modes
    editor/       # Local and master view editor tree components
  lib/
    commands.ts   # All invoke() calls — the only place the frontend talks to Rust
    platform.ts   # Platform-specific labels and behaviours (macOS/Windows/Linux)
  types/          # TypeScript interfaces mirroring Rust models
src-tauri/
  src/
    commands/     # Tauri commands, all registered in main.rs
    db/           # Database init and migration (runs on startup)
    models/       # Shared Rust structs (FileRecord, Property, View, etc.)
```

---

## Database

Single SQLite file managed by Tauri's app data directory. Tables: `files`, `properties`, `property_values`, `views`, `view_nodes`.

The `files.metadata` column is a JSON blob. Use SQLite JSON functions (`json_extract`, `json_each`) to query it. Use `serde_json::Value` to manipulate it in Rust.

Core constraint: files on disk are never moved or renamed by virtual folder operations. All organisation is metadata-only.

---

## Rust conventions

- All Tauri commands live in `src-tauri/src/commands/` and must be registered in `main.rs` via `.invoke_handler(tauri::generate_handler![...])`
- Commands return `Result<T, String>` — map errors with `.map_err(|e| e.to_string())`
- All primary keys are `TEXT` UUIDs — use the `uuid` crate with the `v4` feature
- Derive `serde::Serialize` and `serde::Deserialize` on all models

## Frontend conventions

- Functional components and hooks only — no class components
- All `invoke()` calls go through `src/lib/commands.ts` — components never call `invoke` directly
- State management: React context + useReducer — do not introduce an external state library unless complexity demands it
- No component should compute virtual folder membership — components receive folder contents as data from Rust commands and render them
- Platform-specific behaviour (sidebar label, breadcrumb style, trash verb) lives in `platform.ts` — never branch on `navigator.platform` inline in a component
- **Always use the OS defaults** (see "Native Fidelity Standard" in the spec): system font and sizes, the OS palette (Tailwind's neutral/blue/… scales are remapped to Finder colours in `index.css` — don't hardcode colours), native file/folder icons via `FileIcon`/`FolderIcon`, SF Symbols via `SymbolIcon` (never hand-drawn SVG glyphs, except as fallbacks), native menus via `showContextMenu`. Match metrics against the native file manager rather than guessing

---

## Testing

### Rust unit tests

Write `#[cfg(test)]` modules in the same file as the logic being tested. Run with `cargo test`. Every non-trivial Rust function should have at least a happy path and an error/edge case test.

### Database integration tests

Live in `src-tauri/tests/`. A shared helper `tests/common/mod.rs` creates an in-memory SQLite database and runs the full migration before each test. Commands that touch the database are tested against this in-memory DB — never against a real file.

```rust
// tests/common/mod.rs
pub async fn setup_db() -> SqlitePool {
    let pool = SqlitePool::connect(":memory:").await.unwrap();
    run_migrations(&pool).await.unwrap();
    pool
}
```

### Frontend

Use Vitest for utility functions and anything in `src/lib/`. Component testing with Testing Library can wait until the UI stabilises. Manual testing in `cargo tauri dev` is the primary frontend verification method during early build.

### Fixture files

A small set of test fixture files lives in `src-tauri/tests/fixtures/` — a flat folder containing a few images (with EXIF), a PDF, and a text file. Ingestion tests point at this folder.

**Rule: every build step must leave `cargo test` passing before moving on.**
