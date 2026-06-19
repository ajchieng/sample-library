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
- **Duplicate detection** flags exact file matches and likely similar audio
  without moving or modifying either file.
- **Favorites and drag-and-drop workflows** support faster library triage:
  drop files into the app to import, or drag a library row out to Finder, a
  DAW, or another file-aware app.
- **Open in Finder** reveals and selects the actual file (macOS `open -R`).
- **Remove from library** deletes the database record and the library's managed
  copy after a confirmation; your original file (kept where you imported it from)
  is untouched.

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
  types/sample.ts         # Sample / SampleType / SampleMetadata
src-tauri/
  src/lib.rs              # reveal_in_finder + path_exists commands, plugin setup
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

## Deliberately not built yet

Cloud sync, accounts, payments, sharing, folder scanning, and AI tagging are
out of scope for this MVP (see the product brief for the future-features list).
