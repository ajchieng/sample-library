# Sample Tracker

A private, **local-first** desktop app for managing your own audio sample
library — a tiny offline Splice-style browser. Import samples from anywhere on
your disk into a single managed library folder, tag and annotate them,
search/filter, preview, and jump to the file in Finder. Nothing is uploaded, no
accounts, no cloud.

Built with **Tauri v2 + React + TypeScript + Vite + SQLite** (via the Tauri SQL
plugin).

## What it does

- **Import** `.wav .mp3 .aiff .aif .flac .m4a .ogg` via a native file picker.
  Each file is **copied** into a managed library folder (organized into
  per-type subfolders), kept entirely on your machine — never uploaded. Your
  original files are left exactly where they are.
- **Folder scan + watch** — point the library at one or more folders and Sample
  Tracker recursively finds audio inside them and copies in anything new
  (skipping files already imported). Watched folders are remembered and
  re-scanned on launch and via **Rescan all**, so newly-added samples show up
  over time. Drag a folder onto the window to scan it too. Because the library
  owns its copies, removing a file from a watched folder is reported but never
  deletes your imported sample.
- **Library view** — sortable list with name, type, BPM, key, and tag chips.
- **Detail/editor panel** — edit name, type, BPM, key, mood, source, notes, and
  tags. Renaming changes only the in-app name, never the file on disk.
- **Normalized tags** — stored in `tags` / `sample_tags` tables, reusable across
  samples.
- **Search** across name, tags, type, mood, key, notes, source, and original
  filename.
- **Filters** for type, tag, key, mood, and a BPM min/max range.
- **Audio preview** with play/pause and **spacebar** toggle. Click the waveform
  to seek.
- **Read-only audio analysis** suggests BPM and key values for review before
  applying them, and caches duration, sample rate, and channel metadata.
- **Visible indexing activity** — metadata, hashing, and analysis run in the
  background with a live header indicator and an Activity panel showing
  per-pass progress (e.g. "Analysis 184/2,420"), failures with one-click retry,
  pause/resume, and a short log of what just finished.
- **Duplicate detection** flags exact file matches and likely similar audio
  without moving or modifying either file.
- **Favorites, multi-selection, and drag-and-drop workflows** support faster
  library triage. Shift-click selects a range; Cmd/Ctrl-click toggles files;
  selected files can be copied, removed, or dragged together into Finder, a
  DAW, or another file-aware app.
- **Open in Finder** reveals and selects the actual file (macOS `open -R`).
- **Remove from library** deletes the database record and the library's managed
  copy after a confirmation; your original file (kept where you imported it from)
  is untouched.

## Requirements

- **Node.js** 20 through 24.
- **Rust** toolchain — Tauri compiles a native binary, so this is required to
  run or build the desktop app. Install with:

  ```sh
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```

  Restart your shell (or `source "$HOME/.cargo/env"`) afterwards.

- macOS also needs the Xcode Command Line Tools (`xcode-select --install`).

## Getting started

```sh
npm install          # JS dependencies
npm run tauri dev    # launch the desktop app (compiles Rust on first run)
```

To produce a distributable `.app` / `.dmg`:

```sh
npm run tauri icon src-tauri/icons/icon.png   # generate full icon set (incl. .icns)
npm run tauri build
```

The frontend alone can be type-checked / bundled without Rust:

```sh
npm run build        # tsc + vite build
```

## Development checks and CI

Run the same gates used by CI before opening a pull request:

```sh
npm run check
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
```

The GitHub Actions workflow runs JavaScript checks on Ubuntu and Rust/Tauri
checks plus an unsigned release-app build on macOS. Use `npm run format` to
apply Prettier formatting locally. See
[`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) for the complete release
checklist.

## Project structure

```
src/
  App.tsx                 # app shell, state, import/save/delete/reveal handlers
  components/             # SearchBar, AddSampleButton, FilterBar, SampleList,
                          # SampleRow, SampleEditor, TagEditor, AudioPlayer, Toast
  db/
    schema.ts             # connection + schema init + default tags
    samples.ts            # CRUD wrappers + native atomic-save invocation
  lib/
    files.ts              # path helpers, reveal-in-finder, path existence
    audio.ts              # playback URL conversion + user-facing messages
  types/sample.ts         # Sample / SampleType / SampleMetadata
src-tauri/
  src/lib.rs              # native commands, atomic save, tested file helpers
  tauri.conf.json         # window, asset protocol scope, bundle
  capabilities/default.json
```

## Notes & limitations

- The database lives in the OS app-config directory as `sampletracker.db`, and
  the managed audio library is a `library/` folder beside it.
- On first launch after upgrading, any files previously referenced in place are
  copied into the managed library once (missing files are left as-is).
- Audio preview uses the system WebView (WKWebView on macOS), which can't decode
  every codec — `.flac` and `.ogg` may fail to preview even though the file is
  fine. In that case the app says so and the file remains untouched; everything
  else (Finder, metadata) still works.
- Importing the same source file twice is ignored (detected by its original
  path, which is `UNIQUE`).
- Editable metadata and tags are saved in one SQLite transaction. WAL mode and
  a busy timeout reduce transient lock failures when background reads overlap.
- The current bundle identifier is `com.sampletracker.desktop`. Existing data
  under the earlier `com.sampletracker.app` identifier is migrated at startup
  without overwriting a current database.

## Backups

Back up the complete app-config directory, not only the SQLite file, because it
contains both `sampletracker.db` and the managed `library/` audio folder. On
macOS the current location is:

```text
~/Library/Application Support/com.sampletracker.desktop/
```

Quit Sample Tracker before copying or restoring this directory.

## Deliberately not built yet

Cloud sync, accounts, payments, sharing, and AI tagging are out of scope for
this MVP (see the product brief for the future-features list). Folder scanning
re-scans on demand and at launch; a live always-on filesystem watcher is a
future addition.
