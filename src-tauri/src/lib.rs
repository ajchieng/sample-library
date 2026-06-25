use rusqlite::{params, Connection, TransactionBehavior};
use serde::Deserialize;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::sample::Sample as SymphoniaSample;
use tauri::Manager;

const SUPPORTED_AUDIO_EXTENSIONS: &[&str] = &["wav", "mp3", "aiff", "aif", "flac", "m4a", "ogg"];
const MAX_ANALYSIS_SECONDS: f64 = 90.0;
const FINGERPRINT_VERSION: u32 = 1;
const LEGACY_APP_IDENTIFIER: &str = "com.sampletracker.app";

#[derive(Default)]
struct LibraryPaths(Mutex<HashSet<PathBuf>>);

fn is_supported_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            SUPPORTED_AUDIO_EXTENSIONS
                .iter()
                .any(|supported| ext.eq_ignore_ascii_case(supported))
        })
        .unwrap_or(false)
}

fn normalize_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err("path_not_allowed".into());
    }
    if !is_supported_audio_path(&p) {
        return Err("unsupported_path".into());
    }
    Ok(p)
}

fn is_known_path(paths: &LibraryPaths, path: &str) -> Result<PathBuf, String> {
    let normalized = normalize_path(path)?;
    let known = paths
        .0
        .lock()
        .map_err(|_| "path_registry_locked".to_string())?;
    if known.contains(&normalized) {
        Ok(normalized)
    } else {
        Err("path_not_allowed".into())
    }
}

/// The root of the app-managed library: `<app_config_dir>/library`. Audio files
/// imported into the library are copied here, organized into per-type
/// subfolders. Lives next to the SQLite database in the app config dir.
fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no_app_config_dir: {e}"))?;
    Ok(dir.join("library"))
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("sampletracker.db"))
        .map_err(|e| format!("no_app_config_dir: {e}"))
}

fn open_database(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("open_database_failed: {e}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("busy_timeout_failed: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("wal_failed: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("foreign_keys_failed: {e}"))?;
    Ok(conn)
}

fn open_app_database(app: &tauri::AppHandle) -> Result<Connection, String> {
    open_database(&database_path(app)?)
}

fn migrate_legacy_app_data(current_dir: &Path) -> Result<bool, String> {
    let Some(parent) = current_dir.parent() else {
        return Ok(false);
    };
    let legacy_dir = parent.join(LEGACY_APP_IDENTIFIER);
    if legacy_dir == current_dir || !legacy_dir.exists() {
        return Ok(false);
    }

    let current_db = current_dir.join("sampletracker.db");
    if current_db.exists() {
        // Never merge two libraries implicitly. An existing database under the
        // current identifier is authoritative.
        return Ok(false);
    }

    std::fs::create_dir_all(current_dir)
        .map_err(|e| format!("create_app_config_dir_failed: {e}"))?;
    // Move the database last. Its presence marks the new directory as
    // authoritative, so a crash before that point can safely retry the other
    // entries on the next launch.
    let entries = [
        "library",
        "sampletracker.db-wal",
        "sampletracker.db-shm",
        "sampletracker.db",
    ];
    let mut moved = false;
    for entry in entries {
        let source = legacy_dir.join(entry);
        let destination = current_dir.join(entry);
        if !source.exists() || destination.exists() {
            continue;
        }
        std::fs::rename(&source, &destination)
            .map_err(|e| format!("legacy_data_migration_failed ({entry}): {e}"))?;
        moved = true;
    }
    let _ = std::fs::remove_dir(&legacy_dir);
    Ok(moved)
}

/// Turns a sample `type` into a safe single-segment subfolder name. Strips path
/// separators and characters that are illegal in filenames on common platforms;
/// blank/whitespace-only names fall back to `Uncategorized`.
fn sanitize_subfolder(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "Uncategorized".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Picks a destination path inside `dir` for `filename`, appending ` (2)`,
/// ` (3)`, … before the extension until the path is free. Mirrors the disk's
/// uniqueness with the `file_path UNIQUE` constraint in SQLite.
fn unique_dest(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let ext = path.extension().and_then(|e| e.to_str());
    let mut n = 2u32;
    loop {
        let next_name = match ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        let next = dir.join(next_name);
        if !next.exists() {
            return next;
        }
        n += 1;
    }
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

/// Resolves existing paths (including symlinks) and lexically normalizes
/// missing paths before checking containment. This rejects `library/../...`
/// traversal and symlink escapes rather than relying on a raw prefix check.
fn is_within_root(root: &Path, path: &Path) -> bool {
    let lexical_root = lexical_normalize(root);
    let lexical_path = lexical_normalize(path);
    let resolved_root = std::fs::canonicalize(root).unwrap_or(lexical_root.clone());
    let resolved_path = std::fs::canonicalize(path).unwrap_or_else(|_| {
        lexical_path
            .strip_prefix(&lexical_root)
            .map(|relative| resolved_root.join(relative))
            .unwrap_or(lexical_path)
    });
    resolved_path.starts_with(resolved_root)
}

/// Whether `path` lives inside the managed library root. Used as a safety guard
/// before deleting or moving files, so the app never touches files outside its
/// own folder.
fn is_within_library(app: &tauri::AppHandle, path: &Path) -> bool {
    library_root(app)
        .map(|root| is_within_root(&root, path))
        .unwrap_or(false)
}

// The file-mutation logic is split into pure helpers that take the library
// `root` as an argument (rather than an `AppHandle`) so they can be unit-tested
// against a `tempfile` directory. The `#[tauri::command]` wrappers below just
// resolve the real root and delegate.

/// Copies `source_path` into `root/<sanitized subfolder>/`, de-colliding the
/// filename, and returns the destination. The source is never moved or modified.
fn import_into(root: &Path, source_path: &str, subfolder: &str) -> Result<PathBuf, String> {
    let source = normalize_path(source_path)?;
    if !source.exists() {
        return Err("not_found".into());
    }
    let filename = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "bad_source_filename".to_string())?;

    let dir = root.join(sanitize_subfolder(subfolder));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_failed: {e}"))?;

    let dest = unique_dest(&dir, filename);
    std::fs::copy(&source, &dest).map_err(|e| format!("copy_failed: {e}"))?;
    Ok(dest)
}

/// Moves an already-managed file (one inside `root`) into a different subfolder,
/// returning the new path. No-ops when it's already in the target folder.
/// Rejects paths outside `root`.
fn refile_into(root: &Path, current_path: &str, subfolder: &str) -> Result<PathBuf, String> {
    let current = normalize_path(current_path)?;
    if !is_within_root(root, &current) {
        return Err("not_in_library".into());
    }
    if !current.exists() {
        return Err("not_found".into());
    }
    let filename = current
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "bad_filename".to_string())?;

    let dir = root.join(sanitize_subfolder(subfolder));
    // Already in the right folder — nothing to do.
    if current.parent() == Some(dir.as_path()) {
        return Ok(current);
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_failed: {e}"))?;

    let dest = unique_dest(&dir, filename);
    std::fs::rename(&current, &dest).map_err(|e| format!("move_failed: {e}"))?;
    Ok(dest)
}

/// Deletes a managed file (one inside `root`). A path outside `root` is rejected
/// so the app can never delete something elsewhere; a missing file is success.
fn delete_within(root: &Path, path: &str) -> Result<(), String> {
    let p = normalize_path(path)?;
    if !is_within_root(root, &p) {
        return Err("not_in_library".into());
    }
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete_failed: {e}")),
    }
}

/// Recursively collects supported audio files under `root`, skipping the managed
/// library directory (`library_root`) so a scan never re-imports the app's own
/// copies, and skipping symlinked directories so symlink cycles can't loop
/// forever. Unreadable directories are ignored rather than aborting the walk, so
/// one permission error doesn't sink an otherwise-good scan. Pure (takes explicit
/// roots) so it can be unit-tested against a temp directory.
fn collect_audio_files(root: &Path, library_root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        // Never descend into the managed library — those are our own copies.
        if is_within_root(library_root, &dir) {
            continue;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            // `file_type()` does not follow symlinks, so a symlinked directory
            // reports as a symlink and is skipped — avoiding cycles.
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() && is_supported_audio_path(&path) {
                found.push(path);
            }
        }
    }
    found
}

/// Expands a mix of file and directory paths into the set of supported audio
/// files they contain. Directories are walked recursively; individual files are
/// included when they are supported audio. Paths inside the managed library are
/// excluded (the library owns those copies already), and the result is
/// de-duplicated. Used by the folder picker and folder-aware drag-drop.
#[tauri::command]
async fn scan_paths(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<String>, String> {
    let library_root = library_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for raw in paths {
            let path = PathBuf::from(&raw);
            if !path.is_absolute() {
                continue;
            }
            let candidates = if path.is_dir() {
                collect_audio_files(&path, &library_root)
            } else if path.is_file() && is_supported_audio_path(&path) {
                vec![path]
            } else {
                continue;
            };
            for candidate in candidates {
                if is_within_root(&library_root, &candidate) {
                    continue;
                }
                if seen.insert(candidate.clone()) {
                    out.push(candidate.to_string_lossy().into_owned());
                }
            }
        }
        Ok(out)
    })
    .await
    .map_err(|error| format!("scan_task_failed: {error}"))?
}

/// Copies an arbitrary user-picked audio file into the managed library under
/// `library/<sanitized subfolder>/`, returning the absolute path of the copy.
/// The source is never moved or modified. The source path is validated for
/// being absolute + a supported audio file, but is intentionally NOT required
/// to be a registered library path (it's an external file the user just picked).
#[tauri::command]
async fn import_to_library(
    app: tauri::AppHandle,
    source_path: String,
    subfolder: String,
) -> Result<String, String> {
    let root = library_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(import_into(&root, &source_path, &subfolder)?
            .to_string_lossy()
            .into_owned())
    })
    .await
    .map_err(|error| format!("import_task_failed: {error}"))?
}

/// Deletes the managed copy of a file when a sample is removed from the library.
/// Guarded to only ever delete files inside the library root, so a stray path
/// can never delete something elsewhere on disk. A file that is already gone is
/// treated as success.
#[tauri::command]
async fn delete_library_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let root = library_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || delete_within(&root, &path))
        .await
        .map_err(|error| format!("delete_task_failed: {error}"))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSampleInput {
    id: i64,
    name: String,
    bpm: Option<i64>,
    musical_key: Option<String>,
    sample_type: Option<String>,
    mood: Option<String>,
    source: Option<String>,
    notes: Option<String>,
    tags: Vec<String>,
}

fn normalized_tags(tags: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    tags.iter()
        .map(|tag| tag.trim().to_lowercase())
        .filter(|tag| !tag.is_empty())
        .filter(|tag| seen.insert(tag.clone()))
        .collect()
}

fn save_sample_in_db(conn: &mut Connection, input: &SaveSampleInput) -> Result<(), String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("save_begin_failed: {e}"))?;

    let updated = tx
        .execute(
            "UPDATE samples
                SET name = ?1,
                    bpm = ?2,
                    musical_key = ?3,
                    type = ?4,
                    mood = ?5,
                    source = ?6,
                    notes = ?7,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?8",
            params![
                input.name,
                input.bpm,
                input.musical_key,
                input.sample_type,
                input.mood,
                input.source,
                input.notes,
                input.id
            ],
        )
        .map_err(|e| format!("save_metadata_failed: {e}"))?;
    if updated == 0 {
        return Err("sample_not_found".into());
    }

    let tags = normalized_tags(&input.tags);
    tx.execute(
        "DELETE FROM sample_tags WHERE sample_id = ?1",
        params![input.id],
    )
    .map_err(|e| format!("save_clear_tags_failed: {e}"))?;

    for tag in tags {
        tx.execute(
            "INSERT OR IGNORE INTO tags (name) VALUES (?1)",
            params![tag],
        )
        .map_err(|e| format!("save_tag_failed: {e}"))?;
        tx.execute(
            "INSERT INTO sample_tags (sample_id, tag_id)
             SELECT ?1, id FROM tags WHERE name = ?2",
            params![input.id, tag],
        )
        .map_err(|e| format!("save_sample_tag_failed: {e}"))?;
    }

    tx.commit().map_err(|e| format!("save_commit_failed: {e}"))
}

fn refile_sample_in_db(
    root: &Path,
    conn: &mut Connection,
    id: i64,
    current_path: &str,
    subfolder: &str,
) -> Result<PathBuf, String> {
    let current = normalize_path(current_path)?;
    let moved = refile_into(root, current_path, subfolder)?;
    if moved == current {
        return Ok(moved);
    }

    let update_result = (|| -> Result<(), String> {
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| format!("refile_begin_failed: {e}"))?;
        let updated = tx
            .execute(
                "UPDATE samples
                    SET file_path = ?1,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?2 AND file_path = ?3",
                params![moved.to_string_lossy(), id, current_path],
            )
            .map_err(|e| format!("refile_path_update_failed: {e}"))?;
        if updated == 0 {
            return Err("sample_path_changed".into());
        }
        tx.commit()
            .map_err(|e| format!("refile_commit_failed: {e}"))
    })();

    if let Err(error) = update_result {
        return match std::fs::rename(&moved, &current) {
            Ok(()) => Err(error),
            Err(rollback_error) => {
                Err(format!("{error}; refile_rollback_failed: {rollback_error}"))
            }
        };
    }

    Ok(moved)
}

/// Moves a managed file to its type folder and updates its database path. If
/// the database update fails, the filesystem move is rolled back.
#[tauri::command]
async fn refile_sample(
    app: tauri::AppHandle,
    id: i64,
    current_path: String,
    subfolder: String,
) -> Result<String, String> {
    let root = library_root(&app)?;
    let path = database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_database(&path)?;
        Ok(
            refile_sample_in_db(&root, &mut conn, id, &current_path, &subfolder)?
                .to_string_lossy()
                .into_owned(),
        )
    })
    .await
    .map_err(|error| format!("refile_task_failed: {error}"))?
}

/// Saves sample metadata and tags in one SQLite transaction. This lives in
/// Rust because the SQL plugin may use different pooled connections for
/// sequential frontend calls, which cannot safely share BEGIN/COMMIT state.
#[tauri::command]
async fn save_sample(app: tauri::AppHandle, input: SaveSampleInput) -> Result<(), String> {
    let path = database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_database(&path)?;
        save_sample_in_db(&mut conn, &input)
    })
    .await
    .map_err(|error| format!("save_task_failed: {error}"))?
}

/// Reveals (and selects, where the OS supports it) a file in the native file
/// manager. The file is never modified. Returns `Err("not_found")` when the
/// path no longer exists so the frontend can show a friendly message.
#[tauri::command]
fn reveal_in_finder(paths: tauri::State<'_, LibraryPaths>, path: String) -> Result<(), String> {
    let p = is_known_path(&paths, &path)?;
    if !p.exists() {
        return Err("not_found".into());
    }

    #[cfg(target_os = "macos")]
    {
        // `-R` reveals the file in Finder with it selected.
        std::process::Command::new("open")
            .arg("-R")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        // `/select,` highlights the file in Explorer.
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Most Linux file managers can't select a file from the CLI, so open
        // the containing directory instead.
        let dir = p.parent().unwrap_or_else(|| p.as_path());
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Whether the given path currently exists on disk.
#[tauri::command]
fn path_exists(paths: tauri::State<'_, LibraryPaths>, path: String) -> bool {
    is_known_path(&paths, &path)
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Copies references to the given library files onto the system clipboard, so
/// the user can paste the actual files elsewhere (e.g. ⌘V into Finder). The
/// files themselves are never read, modified, or moved — only file *references*
/// are placed on the pasteboard. Paths must already be registered library files.
#[tauri::command]
fn copy_files_to_clipboard(
    library_paths: tauri::State<'_, LibraryPaths>,
    paths: Vec<String>,
) -> Result<(), String> {
    let valid: Vec<PathBuf> = paths
        .iter()
        .filter_map(|p| is_known_path(&library_paths, p).ok())
        .filter(|p| p.exists())
        .collect();
    if valid.is_empty() {
        return Err("no_valid_paths".into());
    }
    copy_paths_to_clipboard(&valid)
}

#[cfg(target_os = "macos")]
fn copy_paths_to_clipboard(paths: &[PathBuf]) -> Result<(), String> {
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboard, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSString, NSURL};

    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();

    let writers: Vec<_> = paths
        .iter()
        .map(|path| {
            let ns_path = NSString::from_str(&path.to_string_lossy());
            let url = NSURL::fileURLWithPath(&ns_path);
            ProtocolObject::<dyn NSPasteboardWriting>::from_retained(url)
        })
        .collect();
    let objects = NSArray::from_retained_slice(&writers);

    if pasteboard.writeObjects(&objects) {
        Ok(())
    } else {
        Err("clipboard_write_failed".into())
    }
}

#[cfg(not(target_os = "macos"))]
fn copy_paths_to_clipboard(_paths: &[PathBuf]) -> Result<(), String> {
    Err("unsupported_platform".into())
}

/// Given a list of paths, returns the subset that no longer exist on disk.
/// Batched into a single call so a library scan is one IPC round-trip rather
/// than one per sample.
#[tauri::command]
fn missing_paths(library_paths: tauri::State<'_, LibraryPaths>, paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| {
            is_known_path(&library_paths, p)
                .map(|known| !known.exists())
                .unwrap_or(true)
        })
        .collect()
}

/// Given a list of paths, returns the subset that do NOT live inside the managed
/// library root. Used by the one-time migration to find externally-referenced
/// files still to be copied in, and to stay idempotent if it is interrupted
/// (already-managed paths are skipped). Batched into one IPC round-trip.
#[tauri::command]
fn unmanaged_paths(app: tauri::AppHandle, paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| !is_within_library(&app, Path::new(p)))
        .collect()
}

/// Grants the webview asset-protocol read access to exactly the given files.
/// The configured asset scope is empty (see tauri.conf.json), so nothing is
/// readable until a path is allowed here. The frontend calls this with the
/// library's file paths at startup and after each import/relink, so the webview
/// can stream audio for samples that are actually in the library — and nothing
/// else on disk. Files are never read or modified by this call.
#[tauri::command]
fn allow_asset_files(
    app: tauri::AppHandle,
    library_paths: tauri::State<'_, LibraryPaths>,
    paths: Vec<String>,
) -> Result<(), String> {
    let scope = app.asset_protocol_scope();
    let conn = open_app_database(&app)?;
    let mut statement = conn
        .prepare("SELECT file_path FROM samples")
        .map_err(|e| format!("read_library_paths_failed: {e}"))?;
    let database_paths = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("read_library_paths_failed: {e}"))?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(|e| format!("read_library_paths_failed: {e}"))?;
    let next_known = paths
        .into_iter()
        .filter(|path| database_paths.contains(path))
        .filter_map(|path| normalize_path(&path).ok())
        .collect::<HashSet<_>>();
    let mut known = library_paths
        .0
        .lock()
        .map_err(|_| "path_registry_locked".to_string())?;

    for old_path in known.iter() {
        if !next_known.contains(old_path) || !old_path.exists() {
            let _ = scope.forbid_file(old_path);
        }
    }

    for normalized in &next_known {
        // A now-missing path can't be played anyway; keep it in the known set so
        // missing-file detection still works, but only grant asset access for
        // files that currently exist.
        if normalized.exists() {
            let _ = scope.allow_file(normalized);
        }
    }
    *known = next_known;
    Ok(())
}

/// Header-derived audio metadata for a single file. All fields are optional
/// because a given format (or a malformed file) may not report them; the
/// `path` is always echoed back so the frontend can match results to inputs.
#[derive(serde::Serialize)]
struct AudioMeta {
    path: String,
    duration_seconds: Option<f64>,
    sample_rate: Option<u32>,
    channels: Option<u16>,
}

#[derive(serde::Serialize)]
struct FileHashMeta {
    path: String,
    file_size: Option<u64>,
    content_hash: Option<String>,
    status: String,
    error: Option<String>,
}

#[derive(serde::Serialize)]
struct AudioAnalysis {
    path: String,
    detected_bpm: Option<f64>,
    detected_bpm_confidence: Option<f64>,
    detected_key: Option<String>,
    detected_key_confidence: Option<f64>,
    audio_fingerprint: Option<String>,
    fingerprint_version: Option<u32>,
    status: String,
    error: Option<String>,
}

/// Reads audio metadata (duration, sample rate, channel count) from file
/// *headers only* using symphonia — the audio data itself is never decoded,
/// copied, or modified. Batched (Vec in, Vec out) like `missing_paths` so a
/// whole-library scan is a single IPC round-trip.
///
/// Per-path resilience is intentional: any failure for one path (open error,
/// unsupported format, probe failure, missing default track) yields an
/// `AudioMeta` with `None` fields rather than aborting the batch. The output
/// always has exactly one entry per input, in order.
#[tauri::command]
async fn read_metadata(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<AudioMeta>, String> {
    let inputs = {
        let library_paths = app.state::<LibraryPaths>();
        paths
            .into_iter()
            .map(|path| match is_known_path(&library_paths, &path) {
                Ok(_) => Ok(path),
                Err(_) => Err(AudioMeta {
                    path,
                    duration_seconds: None,
                    sample_rate: None,
                    channels: None,
                }),
            })
            .collect::<Vec<_>>()
    };

    tauri::async_runtime::spawn_blocking(move || {
        inputs
            .into_iter()
            .map(|input| match input {
                Ok(path) => read_one(path),
                Err(meta) => meta,
            })
            .collect()
    })
    .await
    .map_err(|err| err.to_string())
}

/// Probes a single file, returning an all-`None` `AudioMeta` on any error so
/// the batch in `read_metadata` can never panic or abort partway through.
fn read_one(path: String) -> AudioMeta {
    let empty = |path: String| AudioMeta {
        path,
        duration_seconds: None,
        sample_rate: None,
        channels: None,
    };

    let file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return empty(path),
    };

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Seed the probe with the file extension so symphonia can pick the right
    // demuxer without sniffing the whole stream.
    let mut hint = Hint::new();
    if let Some(ext) = Path::new(&path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = match symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    ) {
        Ok(p) => p,
        Err(_) => return empty(path),
    };

    let track = match probed.format.default_track() {
        Some(t) => t,
        None => return empty(path),
    };

    let params = &track.codec_params;
    let sample_rate = params.sample_rate;
    let channels = params.channels.map(|c| c.count() as u16);
    let duration_seconds = match (params.n_frames, sample_rate) {
        (Some(frames), Some(rate)) if rate > 0 => Some(frames as f64 / rate as f64),
        _ => None,
    };

    AudioMeta {
        path,
        duration_seconds,
        sample_rate,
        channels,
    }
}

/// Computes exact file hashes for duplicate detection. Input paths must already
/// be registered as library files by `allow_asset_files`.
#[tauri::command]
async fn hash_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<FileHashMeta>, String> {
    let inputs = {
        let library_paths = app.state::<LibraryPaths>();
        paths
            .into_iter()
            .map(|path| match is_known_path(&library_paths, &path) {
                Ok(known) => Ok((path, known)),
                Err(err) => Err(FileHashMeta {
                    path,
                    file_size: None,
                    content_hash: None,
                    status: "error".into(),
                    error: Some(err),
                }),
            })
            .collect::<Vec<_>>()
    };

    tauri::async_runtime::spawn_blocking(move || {
        inputs
            .into_iter()
            .map(|input| match input {
                Ok((path, known)) => hash_one(path, known),
                Err(meta) => meta,
            })
            .collect()
    })
    .await
    .map_err(|err| err.to_string())
}

fn hash_one(path: String, known: PathBuf) -> FileHashMeta {
    let metadata = match std::fs::metadata(&known) {
        Ok(metadata) => metadata,
        Err(err) => {
            return FileHashMeta {
                path,
                file_size: None,
                content_hash: None,
                status: "error".into(),
                error: Some(err.to_string()),
            }
        }
    };

    let mut file = match std::fs::File::open(&known) {
        Ok(file) => file,
        Err(err) => {
            return FileHashMeta {
                path,
                file_size: Some(metadata.len()),
                content_hash: None,
                status: "error".into(),
                error: Some(err.to_string()),
            }
        }
    };

    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buffer[..n]),
            Err(err) => {
                return FileHashMeta {
                    path,
                    file_size: Some(metadata.len()),
                    content_hash: None,
                    status: "error".into(),
                    error: Some(err.to_string()),
                }
            }
        };
    }

    FileHashMeta {
        path,
        file_size: Some(metadata.len()),
        content_hash: Some(hasher.finalize().to_hex().to_string()),
        status: "ok".into(),
        error: None,
    }
}

/// Decodes a bounded slice of each audio file and returns BPM/key suggestions
/// plus a compact fingerprint for likely near-duplicate grouping.
#[tauri::command]
async fn analyze_audio(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<AudioAnalysis>, String> {
    let inputs = {
        let library_paths = app.state::<LibraryPaths>();
        paths
            .into_iter()
            .map(|path| match is_known_path(&library_paths, &path) {
                Ok(known) => Ok((path, known)),
                Err(err) => Err(Box::new(AudioAnalysis {
                    path,
                    detected_bpm: None,
                    detected_bpm_confidence: None,
                    detected_key: None,
                    detected_key_confidence: None,
                    audio_fingerprint: None,
                    fingerprint_version: None,
                    status: "error".into(),
                    error: Some(err),
                })),
            })
            .collect::<Vec<_>>()
    };

    tauri::async_runtime::spawn_blocking(move || {
        inputs
            .into_iter()
            .map(|input| match input {
                Ok((path, known)) => match analyze_one(&known) {
                    Ok(mut analysis) => {
                        analysis.path = path;
                        analysis
                    }
                    Err(err) => AudioAnalysis {
                        path,
                        detected_bpm: None,
                        detected_bpm_confidence: None,
                        detected_key: None,
                        detected_key_confidence: None,
                        audio_fingerprint: None,
                        fingerprint_version: None,
                        status: "error".into(),
                        error: Some(err),
                    },
                },
                Err(analysis) => *analysis,
            })
            .collect()
    })
    .await
    .map_err(|err| err.to_string())
}

fn analyze_one(path: &Path) -> Result<AudioAnalysis, String> {
    let file = std::fs::File::open(path).map_err(|err| err.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|err| err.to_string())?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "no_supported_track".to_string())?;
    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "unknown_sample_rate".to_string())?;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|err| err.to_string())?;

    let max_samples = (sample_rate as f64 * MAX_ANALYSIS_SECONDS) as usize;
    let mut mono = Vec::<f32>::with_capacity(max_samples.min(sample_rate as usize * 15));

    while mono.len() < max_samples {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(_)) | Err(SymphoniaError::ResetRequired) => break,
            Err(err) => return Err(err.to_string()),
        };
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(err) => return Err(err.to_string()),
        };
        push_mono_samples(&decoded, &mut mono, max_samples);
    }

    if mono.len() < sample_rate as usize {
        return Err("not_enough_audio".into());
    }

    let (detected_bpm, detected_bpm_confidence) = estimate_bpm(&mono, sample_rate);
    let (detected_key, detected_key_confidence, chroma) = estimate_key(&mono, sample_rate);
    let audio_fingerprint = build_fingerprint(detected_bpm, detected_key.as_deref(), &chroma);

    Ok(AudioAnalysis {
        path: String::new(),
        detected_bpm,
        detected_bpm_confidence,
        detected_key,
        detected_key_confidence,
        audio_fingerprint,
        fingerprint_version: Some(FINGERPRINT_VERSION),
        status: "ok".into(),
        error: None,
    })
}

fn push_mono_samples(decoded: &AudioBufferRef<'_>, out: &mut Vec<f32>, max_samples: usize) {
    match decoded {
        AudioBufferRef::F32(buf) => push_from_planes(buf, out, max_samples, |v| v),
        AudioBufferRef::U8(buf) => {
            push_from_planes(buf, out, max_samples, |v| (v as f32 - 128.0) / 128.0)
        }
        AudioBufferRef::U16(buf) => {
            push_from_planes(buf, out, max_samples, |v| (v as f32 - 32768.0) / 32768.0)
        }
        AudioBufferRef::U24(buf) => push_from_planes(buf, out, max_samples, |v| {
            (v.inner() as f32 - 8_388_608.0) / 8_388_608.0
        }),
        AudioBufferRef::U32(buf) => push_from_planes(buf, out, max_samples, |v| {
            (v as f32 - 2_147_483_648.0) / 2_147_483_648.0
        }),
        AudioBufferRef::S8(buf) => push_from_planes(buf, out, max_samples, |v| v as f32 / 128.0),
        AudioBufferRef::S16(buf) => push_from_planes(buf, out, max_samples, |v| v as f32 / 32768.0),
        AudioBufferRef::S24(buf) => {
            push_from_planes(buf, out, max_samples, |v| v.inner() as f32 / 8_388_608.0)
        }
        AudioBufferRef::S32(buf) => {
            push_from_planes(buf, out, max_samples, |v| v as f32 / 2_147_483_648.0)
        }
        AudioBufferRef::F64(buf) => push_from_planes(buf, out, max_samples, |v| v as f32),
    }
}

fn push_from_planes<S: Copy + SymphoniaSample, F: Fn(S) -> f32>(
    buf: &symphonia::core::audio::AudioBuffer<S>,
    out: &mut Vec<f32>,
    max_samples: usize,
    convert: F,
) {
    let spec = *buf.spec();
    let channels = spec.channels.count().max(1);
    let frames = buf.frames();
    let planes = buf.planes();
    for frame in 0..frames {
        if out.len() >= max_samples {
            return;
        }
        let mut sum = 0.0_f32;
        for ch in 0..channels {
            sum += convert(planes.planes()[ch][frame]);
        }
        out.push(sum / channels as f32);
    }
}

fn estimate_bpm(samples: &[f32], sample_rate: u32) -> (Option<f64>, Option<f64>) {
    let hop = 1024_usize;
    let energies: Vec<f64> = samples
        .chunks(hop)
        .filter(|chunk| chunk.len() == hop)
        .map(|chunk| {
            chunk
                .iter()
                .map(|sample| (*sample as f64) * (*sample as f64))
                .sum::<f64>()
                / hop as f64
        })
        .collect();
    if energies.len() < 64 {
        return (None, None);
    }

    let mut novelty = Vec::with_capacity(energies.len() - 1);
    for pair in energies.windows(2) {
        novelty.push((pair[1] - pair[0]).max(0.0));
    }
    let mean = novelty.iter().sum::<f64>() / novelty.len() as f64;
    for value in &mut novelty {
        *value = (*value - mean).max(0.0);
    }

    let frames_per_second = sample_rate as f64 / hop as f64;
    let mut best = (0.0_f64, 0.0_f64);
    let mut second = 0.0_f64;
    for bpm in 60..=190 {
        let lag = (frames_per_second * 60.0 / bpm as f64).round() as usize;
        if lag == 0 || lag >= novelty.len() {
            continue;
        }
        let mut score = 0.0_f64;
        for i in lag..novelty.len() {
            score += novelty[i] * novelty[i - lag];
        }
        if score > best.1 {
            second = best.1;
            best = (bpm as f64, score);
        } else if score > second {
            second = score;
        }
    }

    if best.1 <= 0.0 {
        return (None, None);
    }
    let confidence = ((best.1 - second) / best.1).clamp(0.0, 1.0);
    (Some(best.0), Some(confidence))
}

fn estimate_key(samples: &[f32], sample_rate: u32) -> (Option<String>, Option<f64>, [f64; 12]) {
    let mut chroma = [0.0_f64; 12];
    let frame = 4096_usize;
    let step = 4096_usize;
    let limit = samples.len().min(sample_rate as usize * 45);
    let mut offset = 0_usize;
    while offset + frame <= limit {
        for midi in 36..=96 {
            let freq = 440.0 * 2_f64.powf((midi as f64 - 69.0) / 12.0);
            let coeff = goertzel_power(&samples[offset..offset + frame], sample_rate, freq);
            chroma[(midi % 12) as usize] += coeff;
        }
        offset += step;
    }

    let total = chroma.iter().sum::<f64>();
    if total <= f64::EPSILON {
        return (None, None, chroma);
    }
    for value in &mut chroma {
        *value /= total;
    }

    let major = [
        6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
    ];
    let minor = [
        6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
    ];
    let names = [
        "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
    ];
    let mut best = (String::new(), f64::MIN);
    let mut second = f64::MIN;

    for (root, name) in names.iter().enumerate() {
        let major_score = key_score(&chroma, &major, root);
        if major_score > best.1 {
            second = best.1;
            best = ((*name).to_string(), major_score);
        } else if major_score > second {
            second = major_score;
        }

        let minor_score = key_score(&chroma, &minor, root);
        if minor_score > best.1 {
            second = best.1;
            best = (format!("{name}m"), minor_score);
        } else if minor_score > second {
            second = minor_score;
        }
    }

    if best.1 <= f64::MIN / 2.0 {
        return (None, None, chroma);
    }
    let confidence = ((best.1 - second) / best.1.abs().max(1.0)).clamp(0.0, 1.0);
    (Some(best.0), Some(confidence), chroma)
}

fn goertzel_power(samples: &[f32], sample_rate: u32, freq: f64) -> f64 {
    let normalized = freq / sample_rate as f64;
    if normalized <= 0.0 || normalized >= 0.5 {
        return 0.0;
    }
    let coeff = 2.0 * (2.0 * std::f64::consts::PI * normalized).cos();
    let mut q1 = 0.0_f64;
    let mut q2 = 0.0_f64;
    for sample in samples {
        let q0 = coeff * q1 - q2 + *sample as f64;
        q2 = q1;
        q1 = q0;
    }
    q1 * q1 + q2 * q2 - coeff * q1 * q2
}

fn key_score(chroma: &[f64; 12], profile: &[f64; 12], root: usize) -> f64 {
    let mut score = 0.0_f64;
    for i in 0..12 {
        score += chroma[(i + root) % 12] * profile[i];
    }
    score
}

fn build_fingerprint(bpm: Option<f64>, key: Option<&str>, chroma: &[f64; 12]) -> Option<String> {
    let bpm_bucket = bpm.map(|value| ((value / 2.0).round() * 2.0) as u32)?;
    let key = key?;
    let mut ranked: Vec<(usize, f64)> = chroma.iter().copied().enumerate().collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let top = ranked
        .iter()
        .take(4)
        .map(|(idx, _)| format!("{idx:02}"))
        .collect::<Vec<_>>()
        .join("");
    Some(format!("v{FINGERPRINT_VERSION}|{bpm_bucket}|{key}|{top}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let current_dir = app.path().app_config_dir()?;
            migrate_legacy_app_data(&current_dir).map_err(std::io::Error::other)?;
            Ok(())
        })
        .manage(LibraryPaths::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_drag::init())
        .invoke_handler(tauri::generate_handler![
            reveal_in_finder,
            path_exists,
            missing_paths,
            allow_asset_files,
            copy_files_to_clipboard,
            read_metadata,
            hash_files,
            analyze_audio,
            import_to_library,
            refile_sample,
            delete_library_file,
            save_sample,
            unmanaged_paths,
            scan_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn sanitize_subfolder_handles_illegal_and_blank() {
        assert_eq!(sanitize_subfolder("drum"), "drum");
        assert_eq!(sanitize_subfolder("a/b:c*?"), "a_b_c__");
        assert_eq!(sanitize_subfolder("   "), "Uncategorized");
        assert_eq!(sanitize_subfolder(""), "Uncategorized");
        assert_eq!(sanitize_subfolder("..."), "Uncategorized");
    }

    #[test]
    fn migrate_legacy_app_data_moves_database_and_library_once() {
        let dir = tempdir().unwrap();
        let legacy = dir.path().join(LEGACY_APP_IDENTIFIER);
        let current = dir.path().join("com.sampletracker.desktop");
        fs::create_dir_all(legacy.join("library")).unwrap();
        fs::write(legacy.join("sampletracker.db"), b"db").unwrap();
        fs::write(legacy.join("library").join("kick.wav"), b"audio").unwrap();

        assert!(migrate_legacy_app_data(&current).unwrap());
        assert_eq!(fs::read(current.join("sampletracker.db")).unwrap(), b"db");
        assert_eq!(
            fs::read(current.join("library").join("kick.wav")).unwrap(),
            b"audio"
        );
        assert!(!migrate_legacy_app_data(&current).unwrap());
    }

    #[test]
    fn migrate_legacy_app_data_never_overwrites_current_database() {
        let dir = tempdir().unwrap();
        let legacy = dir.path().join(LEGACY_APP_IDENTIFIER);
        let current = dir.path().join("com.sampletracker.desktop");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&current).unwrap();
        fs::write(legacy.join("sampletracker.db"), b"legacy").unwrap();
        fs::write(current.join("sampletracker.db"), b"current").unwrap();

        assert!(!migrate_legacy_app_data(&current).unwrap());
        assert_eq!(
            fs::read(current.join("sampletracker.db")).unwrap(),
            b"current"
        );
        assert_eq!(
            fs::read(legacy.join("sampletracker.db")).unwrap(),
            b"legacy"
        );
    }

    #[test]
    fn unique_dest_appends_a_counter_on_collision() {
        let dir = tempdir().unwrap();
        let d = dir.path();
        assert_eq!(unique_dest(d, "kick.wav"), d.join("kick.wav"));
        fs::write(d.join("kick.wav"), b"x").unwrap();
        assert_eq!(unique_dest(d, "kick.wav"), d.join("kick (2).wav"));
        fs::write(d.join("kick (2).wav"), b"x").unwrap();
        assert_eq!(unique_dest(d, "kick.wav"), d.join("kick (3).wav"));
    }

    #[test]
    fn import_into_copies_and_leaves_source_untouched() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        let src = dir.path().join("kick.wav");
        fs::write(&src, b"audio").unwrap();

        let dest = import_into(&root, src.to_str().unwrap(), "drum").unwrap();
        assert!(dest.starts_with(root.join("drum")));
        assert_eq!(fs::read(&dest).unwrap(), b"audio");
        assert!(src.exists(), "source must not be moved");
    }

    #[test]
    fn import_into_empty_subfolder_falls_back_to_uncategorized() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        let src = dir.path().join("kick.wav");
        fs::write(&src, b"a").unwrap();
        let dest = import_into(&root, src.to_str().unwrap(), "").unwrap();
        assert!(dest.starts_with(root.join("Uncategorized")));
    }

    #[test]
    fn import_into_de_collides_repeated_imports() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        let src = dir.path().join("kick.wav");
        fs::write(&src, b"a").unwrap();
        let first = import_into(&root, src.to_str().unwrap(), "drum").unwrap();
        let second = import_into(&root, src.to_str().unwrap(), "drum").unwrap();
        assert_ne!(first, second);
        assert!(second
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .contains("(2)"));
    }

    #[test]
    fn refile_into_moves_between_subfolders() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        let src = dir.path().join("kick.wav");
        fs::write(&src, b"a").unwrap();
        let imported = import_into(&root, src.to_str().unwrap(), "").unwrap();
        let moved = refile_into(&root, imported.to_str().unwrap(), "drum").unwrap();
        assert!(moved.starts_with(root.join("drum")));
        assert!(!imported.exists());
        assert!(moved.exists());
    }

    #[test]
    fn refile_into_rejects_paths_outside_root() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        let outside = dir.path().join("outside.wav");
        fs::write(&outside, b"a").unwrap();
        let err = refile_into(&root, outside.to_str().unwrap(), "drum").unwrap_err();
        assert_eq!(err, "not_in_library");
        assert!(outside.exists());
    }

    #[test]
    fn refile_into_rejects_parent_traversal_outside_root() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        fs::create_dir_all(&root).unwrap();
        let outside = dir.path().join("outside.wav");
        fs::write(&outside, b"a").unwrap();
        let traversal = root.join("..").join("outside.wav");

        let err = refile_into(&root, traversal.to_str().unwrap(), "drum").unwrap_err();
        assert_eq!(err, "not_in_library");
        assert!(outside.exists());
    }

    #[test]
    fn collect_audio_files_recurses_and_filters_by_extension() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("samples");
        let library = dir.path().join("library");
        fs::create_dir_all(root.join("drums")).unwrap();
        fs::write(root.join("kick.wav"), b"a").unwrap();
        fs::write(root.join("drums").join("snare.aiff"), b"a").unwrap();
        fs::write(root.join("notes.txt"), b"a").unwrap();
        fs::write(root.join("cover.png"), b"a").unwrap();

        let mut found: Vec<String> = collect_audio_files(&root, &library)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        found.sort();
        assert_eq!(found, vec!["kick.wav", "snare.aiff"]);
    }

    #[test]
    fn collect_audio_files_skips_the_managed_library() {
        let dir = tempdir().unwrap();
        // The scanned root *contains* the managed library as a subfolder.
        let root = dir.path().join("music");
        let library = root.join("library");
        fs::create_dir_all(library.join("drum")).unwrap();
        fs::write(root.join("outside.wav"), b"a").unwrap();
        fs::write(library.join("drum").join("managed.wav"), b"a").unwrap();

        let found: Vec<String> = collect_audio_files(&root, &library)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(found, vec!["outside.wav"]);
    }

    #[test]
    fn collect_audio_files_tolerates_a_missing_root() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        let library = dir.path().join("library");
        assert!(collect_audio_files(&missing, &library).is_empty());
    }

    #[test]
    fn delete_within_only_deletes_inside_root() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        let src = dir.path().join("kick.wav");
        fs::write(&src, b"a").unwrap();
        let imported = import_into(&root, src.to_str().unwrap(), "drum").unwrap();

        delete_within(&root, imported.to_str().unwrap()).unwrap();
        assert!(!imported.exists());
        // A second delete of the now-missing file is still Ok.
        delete_within(&root, imported.to_str().unwrap()).unwrap();

        // A path outside the library is rejected and left in place.
        let outside = dir.path().join("outside.wav");
        fs::write(&outside, b"a").unwrap();
        let err = delete_within(&root, outside.to_str().unwrap()).unwrap_err();
        assert_eq!(err, "not_in_library");
        assert!(outside.exists());
    }

    #[test]
    fn delete_within_rejects_parent_traversal_outside_root() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        fs::create_dir_all(&root).unwrap();
        let outside = dir.path().join("outside.wav");
        fs::write(&outside, b"a").unwrap();
        let traversal = root.join("..").join("outside.wav");

        let err = delete_within(&root, traversal.to_str().unwrap()).unwrap_err();
        assert_eq!(err, "not_in_library");
        assert!(outside.exists());
    }

    fn sample_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE samples (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                file_path TEXT NOT NULL UNIQUE,
                bpm INTEGER,
                musical_key TEXT,
                type TEXT,
                mood TEXT,
                source TEXT,
                notes TEXT,
                updated_at TEXT
            );
            CREATE TABLE tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );
            CREATE TABLE sample_tags (
                sample_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (sample_id, tag_id),
                FOREIGN KEY (sample_id) REFERENCES samples(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );
            INSERT INTO samples (id, name, file_path, updated_at)
            VALUES (1, 'old', '/library/Uncategorized/kick.wav', 'before');
            ",
        )
        .unwrap();
        conn
    }

    fn save_input() -> SaveSampleInput {
        SaveSampleInput {
            id: 1,
            name: "New name".into(),
            bpm: Some(120),
            musical_key: Some("Am".into()),
            sample_type: Some("loop".into()),
            mood: Some("dusty".into()),
            source: Some("record".into()),
            notes: Some("trim tail".into()),
            tags: vec![" Drums ".into(), "drums".into(), "SOUL".into()],
        }
    }

    #[test]
    fn save_sample_in_db_updates_metadata_and_replaces_tags_atomically() {
        let mut conn = sample_db();
        conn.execute("INSERT INTO tags (name) VALUES ('old-tag')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id)
             SELECT 1, id FROM tags WHERE name = 'old-tag'",
            [],
        )
        .unwrap();

        save_sample_in_db(&mut conn, &save_input()).unwrap();

        let metadata: (String, Option<i64>, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT name, bpm, musical_key, type FROM samples WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            metadata,
            (
                "New name".into(),
                Some(120),
                Some("Am".into()),
                Some("loop".into())
            )
        );

        let mut statement = conn
            .prepare(
                "SELECT tags.name
                 FROM tags
                 JOIN sample_tags ON sample_tags.tag_id = tags.id
                 WHERE sample_tags.sample_id = 1
                 ORDER BY tags.name",
            )
            .unwrap();
        let tags = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(tags, vec!["drums", "soul"]);
    }

    #[test]
    fn save_sample_in_db_rolls_back_metadata_when_tag_write_fails() {
        let mut conn = sample_db();
        conn.execute_batch(
            "
            CREATE TRIGGER reject_sample_tags
            BEFORE INSERT ON sample_tags
            BEGIN
                SELECT RAISE(ABORT, 'injected tag failure');
            END;
            ",
        )
        .unwrap();

        let err = save_sample_in_db(&mut conn, &save_input()).unwrap_err();
        assert!(err.contains("save_sample_tag_failed"));

        let name: String = conn
            .query_row("SELECT name FROM samples WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(name, "old");
        let tag_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags WHERE sample_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tag_count, 0);
    }

    #[test]
    fn refile_sample_in_db_moves_file_and_updates_path() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        let source = dir.path().join("source.wav");
        fs::write(&source, b"audio").unwrap();
        let current = import_into(&root, source.to_str().unwrap(), "").unwrap();

        let mut conn = sample_db();
        conn.execute(
            "UPDATE samples SET file_path = ?1 WHERE id = 1",
            params![current.to_string_lossy()],
        )
        .unwrap();

        let moved =
            refile_sample_in_db(&root, &mut conn, 1, current.to_str().unwrap(), "drum").unwrap();
        assert!(moved.starts_with(root.join("drum")));
        assert!(!current.exists());
        assert!(moved.exists());

        let stored: String = conn
            .query_row("SELECT file_path FROM samples WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, moved.to_string_lossy());
    }

    #[test]
    fn refile_sample_in_db_rolls_file_back_when_database_update_fails() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        let source = dir.path().join("source.wav");
        fs::write(&source, b"audio").unwrap();
        let current = import_into(&root, source.to_str().unwrap(), "").unwrap();

        let mut conn = sample_db();
        conn.execute(
            "UPDATE samples SET file_path = ?1 WHERE id = 1",
            params![current.to_string_lossy()],
        )
        .unwrap();
        conn.execute_batch(
            "
            CREATE TRIGGER reject_refile
            BEFORE UPDATE OF file_path ON samples
            BEGIN
                SELECT RAISE(ABORT, 'injected refile failure');
            END;
            ",
        )
        .unwrap();

        let error = refile_sample_in_db(&root, &mut conn, 1, current.to_str().unwrap(), "drum")
            .unwrap_err();
        assert!(error.contains("refile_path_update_failed"));
        assert!(current.exists());
        assert!(!root
            .join("drum")
            .join(current.file_name().unwrap())
            .exists());

        let stored: String = conn
            .query_row("SELECT file_path FROM samples WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, current.to_string_lossy());
    }
}
