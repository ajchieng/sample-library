# Repository Guidelines

## Project Structure & Module Organization

This is a local-first sample library app built with Tauri v2, React, TypeScript, Vite, and SQLite.

- `src/` contains the frontend application.
- `src/App.tsx` owns top-level state, sample actions, filtering, and keyboard navigation.
- `src/components/` contains UI components such as `SampleList`, `SampleEditor`, `AudioPlayer`, and filters.
- `src/db/` contains SQLite schema setup and all sample/tag CRUD code. Keep SQL isolated here.
- `src/lib/` contains file, audio, and platform helpers.
- `src/types/` contains shared TypeScript data shapes.
- `src-tauri/` contains the Rust Tauri shell, commands, capabilities, and bundle configuration.
- `scripts/` contains maintenance scripts such as icon generation.

## Build, Test, and Development Commands

- `npm install` installs JavaScript dependencies from `package-lock.json`.
- `npm run dev` starts the Vite frontend only for browser-level UI iteration.
- `npm run tauri dev` launches the desktop app and compiles the Rust shell.
- `npm run build` runs `tsc` and creates a Vite production build.
- `npm run tauri build` creates the distributable desktop app.
- `npm run gen:icons` runs `scripts/gen-icons.cjs` when app icons need regeneration.

There is currently no dedicated `test` or `lint` script in `package.json`.

## Coding Style & Naming Conventions

Use TypeScript with strict compiler settings. Prefer functional React components, hooks, and typed props. Components use `PascalCase` filenames, helpers use `camelCase`, and domain types live in `src/types`. Use two-space indentation in TypeScript/TSX and standard Rust formatting in `src-tauri`. Keep file operations non-destructive to the user's originals: importing copies audio into an app-managed library folder (never moving or modifying the source), and all managed-library mutations must respect the invariants in CLAUDE.md (copy-not-move on import, reject paths outside the library root, no path traversal).

## Testing Guidelines

No automated test framework is configured yet. Before opening a PR, run `npm run build` and, for desktop behavior, `npm run tauri dev`. Manually verify import, search/filter, edit/save, preview, reveal in Finder, missing-file detection, relink, and remove-from-library flows.

## Commit & Pull Request Guidelines

The git history currently has only `first commit`, so no detailed convention is established. Use short imperative commit messages, for example `Add sample relink flow` or `Fix missing file filter`. Pull requests should include a concise summary, validation commands run, screenshots for UI changes, and notes for any Tauri permission or database schema changes.

## Security & Configuration Tips

Do not add cloud upload, account, telemetry, or file mutation behavior without explicit product scope. Keep Tauri capabilities narrow, avoid broad filesystem access, and document any new native command in both Rust and the frontend wrapper.
