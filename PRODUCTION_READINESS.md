# Production Readiness

This checklist is the release gate for Sample Tracker. Keep completed items
checked and treat unchecked items as release-owner actions, not optional notes.

## Automated gates

- [x] ESLint flat configuration with React Hooks and jsx-a11y rules
- [x] Prettier formatting check
- [x] Strict TypeScript and Vite production build
- [x] Frontend/data unit tests
- [x] Rust formatting, Clippy with warnings denied, and Rust unit tests
- [x] Dependency audit for npm packages
- [x] RustSec audit is enforced in GitHub Actions
- [x] Unsigned macOS release-app build
- [x] GitHub Actions runs frontend checks on Ubuntu
- [x] GitHub Actions runs Rust checks and a Tauri release build on macOS
- [x] Dependabot monitors npm, Cargo, and GitHub Actions dependencies

## Data and filesystem safety

- [x] Imports copy source files and clean up unowned copies after database errors
- [x] Relinks update both managed and original paths and clean up failed copies
- [x] Metadata and tags save in one SQLite transaction
- [x] Type refiling updates the file and database path with rollback on failure
- [x] SQLite uses WAL mode and a bounded busy timeout
- [x] File mutation helpers reject traversal and paths outside the library root
- [x] Webview asset access is limited to paths currently stored in SQLite
- [x] Interrupted library migrations retry transient failures
- [x] Missing legacy files remain visible through the relink flow
- [x] Bundle-identifier correction preserves existing app data with a
      non-overwriting startup migration

## Application hardening

- [x] React render errors show a recoverable error screen
- [x] Tauri capabilities remain limited to required dialog, SQL, and drag APIs
- [x] Asset-protocol scope starts empty and is populated at runtime
- [x] Content Security Policy blocks remote scripts, frames, and objects
- [x] Production dependency audit currently reports no npm vulnerabilities
- [x] RustSec audit passes with `RUSTSEC-2023-0071` explicitly ignored because
      it belongs to sqlx's unused optional MySQL/RSA backend and is absent from
      `cargo tree --target all`

## Release-owner checks

- [ ] Run the manual desktop smoke test on the built `.app`: first launch,
      import, search/filter, edit/save, playback, reveal, copy, native drag,
      missing-file detection, relink, and remove
- [ ] Test upgrade behavior using a backup copy of an existing pre-migration
      database and sample set
- [ ] Set the intended release version consistently in `package.json`,
      `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`
- [ ] Sign and notarize the macOS app with the release Apple Developer identity
- [ ] Verify the signed DMG on a separate Mac using Gatekeeper
- [ ] Decide the distribution/update channel and publish release notes
- [ ] Back up the app-config directory before every migration-bearing release

## Deferred upgrades

Major upgrades such as React 19, Vite 8, ESLint 10, and TypeScript 6 require a
separate compatibility pass. They are intentionally not mixed into release
hardening while the current supported versions are secure and passing.
