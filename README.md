# Sample Tracker

A private, **local-first** desktop app for managing your own audio sample
library — a tiny offline Splice-style browser. Import samples from anywhere on
your disk, tag and annotate them, search/filter, preview, and jump to the file
in Finder. Nothing is uploaded, no accounts, no cloud.

Built with **Tauri v2 + React + TypeScript + Vite + SQLite** (via the Tauri SQL
plugin).

## What it does

- **Import** `.wav .mp3 .aiff .aif .flac .m4a .ogg` via a native file picker.
  Only the file **path** and metadata are stored — your audio files are never
  copied, moved, renamed, or uploaded.
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
- **Open in Finder** reveals and selects the actual file (macOS `open -R`).
- **Remove from library** deletes only the database record after a confirmation;
  the original file stays on disk.

## Requirements

- **Node.js** 18+ (you have v24).
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

## Project structure

```
src/
  App.tsx                 # app shell, state, import/save/delete/reveal handlers
  components/             # SearchBar, AddSampleButton, FilterBar, SampleList,
                          # SampleRow, SampleEditor, TagEditor, AudioPlayer, Toast
  db/
    schema.ts             # connection + schema init + default tags
    samples.ts            # all SQL (CRUD, tags) — isolated here
  lib/
    files.ts              # path helpers, reveal-in-finder, path existence
    audio.ts              # asset-URL conversion + user-facing messages
    typeColors.ts         # type → accent colour
  types/sample.ts         # Sample / SampleType / SampleMetadata
src-tauri/
  src/lib.rs              # reveal_in_finder + path_exists commands, plugin setup
  tauri.conf.json         # window, asset protocol scope, bundle
  capabilities/default.json
```

## Notes & limitations

- The database lives in the OS app-config directory as `sampletracker.db`.
- Audio preview uses the system WebView (WKWebView on macOS), which can't decode
  every codec — `.flac` and `.ogg` may fail to preview even though the file is
  fine. In that case the app says so and the file remains untouched; everything
  else (Finder, metadata) still works.
- Importing the same file path twice is ignored (the path column is `UNIQUE`).

## Deliberately not built yet

Cloud sync, accounts, payments, sharing, automatic BPM/key detection, waveform
analysis, duplicate fingerprinting, folder scanning, and AI tagging are out of
scope for this MVP (see the product brief for the future-features list).
