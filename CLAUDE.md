# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install            # JS dependencies
npm run tauri dev      # full desktop app — compiles Rust on first run (use this for anything beyond pure UI)
npm run dev            # Vite only, no Rust (see caveat below)
npm run build          # tsc + vite build — type-checks and bundles the frontend; works without the Rust toolchain
npm test               # Vitest — unit tests for pure logic (src/**/*.test.ts)
npm run lint           # ESLint flat config: TypeScript, React hooks, jsx-a11y
npm run format:check   # verify Prettier formatting
npm run format         # rewrite supported files with Prettier
npm run check          # all frontend gates above: lint, format, build, tests
npm run tauri build    # distributable .app / .dmg
npm run tauri icon src-tauri/icons/icon.png   # regenerate the icon set (incl. .icns) before a release build
```

Verification gates before a PR:

```sh
npm run lint
npm run format:check
npm run build
npm test
(cd src-tauri && cargo fmt --check)
(cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings)
(cd src-tauri && cargo test --all-targets --all-features)
```

Vitest runs in a node environment and covers pure frontend/data logic, not a live DOM or Tauri runtime. Rust unit tests cover native filesystem and SQLite transaction helpers using temporary/in-memory storage. GitHub Actions runs the JavaScript gates on Ubuntu and the Rust gates on macOS. Pure helpers are deliberately extracted into plain modules (e.g. `src/lib/player.ts`) so they're testable without pulling React/wavesurfer into the node test env.

Running the Rust backend requires the Rust toolchain + (on macOS) Xcode Command Line Tools.

## The managed-library model (do not break this)

The library **owns a copy** of every audio file inside a dedicated folder, `<app_config_dir>/library/` (a sibling of `sampletracker.db`). Files are organized into per-`type` subfolders (e.g. `library/drum/`, `library/loop/`); samples with no type yet live in `library/Uncategorized/`. The library is **app-managed but never uploaded** — everything stays local. Invariants that must be preserved:

- **Import copies, never moves.** Importing a sample copies the file into the library and stores both `file_path` (the managed copy, the source of truth for playback/reveal/hashing) and `original_path` (where the user imported it from). The user's original file is left untouched (`importToLibrary` → Rust `import_to_library`).
- **The library is type-organized on disk.** Changing a sample's `type` re-files its audio into the matching subfolder (`refileSample` → Rust `refile_sample`); the native helper updates the database path and rolls the file move back if that update fails.
- **"Remove from library" deletes the managed copy too** (`handleDelete` → `deleteSample` + `deleteLibraryFile`). This is safe because copy-mode import preserved the user's original elsewhere. The Rust `delete_library_file` refuses any path outside the library root, so it can never delete a file elsewhere on disk.
- **Renaming a sample changes the in-app `name` only**, never the file (`updateSample`).
- **"Relink" copies the chosen file into the library** and re-points the row at the managed copy (`handleRelink` → `import_to_library` + `relinkSample`).
- **Duplicate detection keys off `original_path`**, not `file_path` — every managed copy gets a fresh unique path, so two imports of the same source are caught by the `original_path` clash, not the `file_path` one.
- **One-time migration.** On first launch after this feature, existing externally-referenced files are copied into the library (`runLibraryMigration` in `App.tsx`), guarded by the `library_migrated` flag in `app_meta` and resumable via the batched `unmanaged_paths` IPC (already-managed files are skipped). Missing files are left external and reported.

## Architecture

Three layers with a strict division of labor:

**Rust backend** (`src-tauri/src/lib.rs`) — native filesystem commands plus transactional SQLite helpers for sample saves and type refiling. File helpers take explicit roots so they can be tested against temporary directories. Managed-library mutations reject traversal and paths outside the library. The asset registry intersects frontend requests with paths stored in SQLite. Adding a command requires the `#[tauri::command]` fn and registration in `invoke_handler` (`generate_handler!`); plugin-backed APIs also need a matching permission in `src-tauri/capabilities/default.json`.

**Data layer** (`src/db/`) — components and `App.tsx` never write SQL. `schema.ts` owns the plugin connection and idempotent schema init; `samples.ts` owns CRUD wrappers and invokes the native atomic save. `getDb()` caches a single connection promise so React StrictMode's double-invoked effects reuse one connection and run init once. Both database paths enable WAL and a five-second busy timeout.

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

## Release readiness

`PRODUCTION_READINESS.md` is the release checklist. Automated checks and an unsigned macOS bundle can be produced locally, but signing, notarization, separate-machine Gatekeeper verification, and the manual desktop workflow remain release-owner gates.

The bundle identifier is `com.sampletracker.desktop`. Startup includes a one-time, non-overwriting migration from the earlier `com.sampletracker.app` app-config directory so existing local libraries are preserved.

## Repo-local subagents

`.claude/agents/` defines domain-scoped agents (`react-frontend`, `sqlite-data`, `audio-playback`, `tauri-backend`) that mirror the layer boundaries above — useful for routing focused work.
