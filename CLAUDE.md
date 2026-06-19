# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install            # JS dependencies
npm run tauri dev      # full desktop app — compiles Rust on first run (use this for anything beyond pure UI)
npm run dev            # Vite only, no Rust (see caveat below)
npm run build          # tsc + vite build — type-checks and bundles the frontend; works without the Rust toolchain
npm test               # Vitest — unit tests for pure logic (src/**/*.test.ts)
npm run tauri build    # distributable .app / .dmg
npm run tauri icon src-tauri/icons/icon.png   # regenerate the icon set (incl. .icns) before a release build
```

Verification gates: `npm test` (Vitest, node env — covers **pure logic only**, no DOM/Tauri), `npm run build` (`tsc` type-check + bundle), and `cargo check` in `src-tauri/` for backend changes. No linter is configured, so ESLint-style rules (e.g. jsx-a11y) only surface as IDE diagnostics, not build failures. Pure helpers are deliberately extracted into plain modules (e.g. `src/lib/player.ts`) so they're testable without pulling React/wavesurfer into the node test env.

Running the Rust backend requires the Rust toolchain + (on macOS) Xcode Command Line Tools.

## The managed-library model (do not break this)

The library **owns a copy** of every audio file inside a dedicated folder, `<app_config_dir>/library/` (a sibling of `sampletracker.db`). Files are organized into per-`type` subfolders (e.g. `library/drum/`, `library/loop/`); samples with no type yet live in `library/Uncategorized/`. The library is **app-managed but never uploaded** — everything stays local. Invariants that must be preserved:

- **Import copies, never moves.** Importing a sample copies the file into the library and stores both `file_path` (the managed copy, the source of truth for playback/reveal/hashing) and `original_path` (where the user imported it from). The user's original file is left untouched (`importToLibrary` → Rust `import_to_library`).
- **The library is type-organized on disk.** Changing a sample's `type` re-files its audio into the matching subfolder (`refileInLibrary` → Rust `refile_in_library`); helpers in `lib.rs` sanitize the folder name and de-collide filenames (appending `(2)`, `(3)`, … before the extension).
- **"Remove from library" deletes the managed copy too** (`handleDelete` → `deleteSample` + `deleteLibraryFile`). This is safe because copy-mode import preserved the user's original elsewhere. The Rust `delete_library_file` refuses any path outside the library root, so it can never delete a file elsewhere on disk.
- **Renaming a sample changes the in-app `name` only**, never the file (`updateSample`).
- **"Relink" copies the chosen file into the library** and re-points the row at the managed copy (`handleRelink` → `import_to_library` + `relinkSample`).
- **Duplicate detection keys off `original_path`**, not `file_path` — every managed copy gets a fresh unique path, so two imports of the same source are caught by the `original_path` clash, not the `file_path` one.
- **One-time migration.** On first launch after this feature, existing externally-referenced files are copied into the library (`runLibraryMigration` in `App.tsx`), guarded by the `library_migrated` flag in `app_meta` and resumable via the batched `unmanaged_paths` IPC (already-managed files are skipped). Missing files are left external and reported.

## Architecture

Three layers with a strict division of labor:

**Rust backend** (`src-tauri/src/lib.rs`) — the thin filesystem commands: read-only ones (`reveal_in_finder`, `path_exists`, `missing_paths`, `read_metadata`, `hash_files`, `analyze_audio`, `copy_files_to_clipboard`, `allow_asset_files`) plus the managed-library write commands (`import_to_library`, `refile_in_library`, `delete_library_file`, `unmanaged_paths`). The write commands use plain `std::fs` and resolve the library root via `app.path().app_config_dir()` — no extra crate or capability needed. Mutating commands are guarded by `is_within_library` so the app only ever writes inside its own folder. Adding a command requires three edits in lockstep: the `#[tauri::command]` fn, its registration in `invoke_handler` (`generate_handler!`), and (for plugin-backed APIs) a matching permission in `src-tauri/capabilities/default.json` (a missing capability surfaces as a runtime permission error, not a compile error).

**Data layer** (`src/db/`) — **all SQL lives here**; components and `App.tsx` never write SQL. `schema.ts` owns the connection and idempotent schema init; `samples.ts` owns CRUD and tag mutations. `getDb()` caches a single connection promise so React StrictMode's double-invoked effects reuse one connection and run init once.

**React frontend** (`src/`) — `App.tsx` is the single source of truth for state. `reload()` is the **one refresh path** called after every mutation (it re-runs `listSamples` + `listAllTags` + the missing-file scan). Search and all filtering happen **client-side** over the in-memory `samples` array (the `visible` memo), not in SQL — so new filterable fields are added to that memo, not to a query.

### Schema & migrations

`initDb()` creates a **baseline** schema with `CREATE TABLE IF NOT EXISTS` (+ indexes, + `INSERT OR IGNORE` tag seed), then runs a `PRAGMA user_version`-based migration runner. **Schema-change discipline (important):** new columns and other non-idempotent changes go in a `MIGRATIONS` entry in `schema.ts` with the next version number — **never** by editing the baseline `CREATE TABLE`. That way fresh DBs (baseline + every migration) and existing DBs (only pending migrations) converge via the same path. `pendingMigrations(currentVersion, migrations)` is the pure, unit-tested selector. Note transactions can't span the migration steps (the SQL plugin pools connections — see the project memory), so each `up` should be individually safe. Tags are normalized across `tags` + `sample_tags`; `listSamples` flattens them with `GROUP_CONCAT(t.name, char(31)) AS tag_csv` (ASCII unit separator, not comma, so commas in tags survive) and splits in `rowToSample`. The DB file lives in the OS app-config dir as `sampletracker.db`. Migration v5 added `samples.original_path` (UNIQUE, backfilled from `file_path`) and the `app_meta(key, value)` key-value table used for run-once flags such as `library_migrated`.

### Cross-boundary error handling

Typed JS errors are reconstructed by **string-matching the raw error** that crosses the SQL or IPC boundary. `DuplicateSampleError` is detected via `String(err).includes("UNIQUE")` — now most often the `original_path UNIQUE` constraint on import, still the `file_path UNIQUE` one on relink; `FileNotFoundError` via Rust returning `Err("not_found")` (used by `import_to_library`/`reveal_in_finder` when the source file is gone). If you change one of those sentinel strings, update both sides.

### Derived (non-persisted) state

"Missing files" is **never stored** — it's recomputed via the batched `missing_paths` IPC call (one round-trip for the whole library) and held as a `Set<number>` of sample IDs in `App` state. `onlyMissing` is a view filter over that set.

### Audio playback

Files are streamed through Tauri's **asset protocol** (`convertFileSrc` in `lib/audio.ts`; `tauri.conf.json` starts with an empty asset scope and `allow_asset_files` grants runtime access only for known library audio paths) — no copying. Decoding is delegated to the system WebView (WKWebView on macOS), so `.flac`/`.ogg` may fail to preview even when the file is fine; `AudioPlayer` distinguishes "moved/deleted" from "unsupported codec" by calling `path_exists` on the audio `error` event.

`AudioPlayer` renders a real waveform with `wavesurfer.js`, which **fetches the audio over the asset protocol** to decode peaks — so it exercises the same scope as playback (a path must be allowed via `allow_asset_files` or both the waveform and audio fail to load). wavesurfer owns click/drag seeking; its `error` event drives the missing-vs-unsupported fallback (and filters `AbortError` from rapid sample-switching).

### Dev-server caveat

`npm run dev` serves the webview frontend **without the Tauri runtime**, so `invoke()`, the SQL plugin, and the dialog plugin all fail there. Use `npm run tauri dev` for anything beyond pure UI/type work. Vite is pinned to port 1420 (`strictPort`) to match `tauri.conf.json`'s `devUrl`.

## Repo-local subagents

`.claude/agents/` defines domain-scoped agents (`react-frontend`, `sqlite-data`, `audio-playback`, `tauri-backend`) that mirror the layer boundaries above — useful for routing focused work.
