use std::path::Path;

/// Reveals (and selects, where the OS supports it) a file in the native file
/// manager. The file is never modified. Returns `Err("not_found")` when the
/// path no longer exists so the frontend can show a friendly message.
#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("not_found".into());
    }

    #[cfg(target_os = "macos")]
    {
        // `-R` reveals the file in Finder with it selected.
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        // `/select,` highlights the file in Explorer.
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Most Linux file managers can't select a file from the CLI, so open
        // the containing directory instead.
        let dir = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Whether the given path currently exists on disk.
#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Given a list of paths, returns the subset that no longer exist on disk.
/// Batched into a single call so a library scan is one IPC round-trip rather
/// than one per sample.
#[tauri::command]
fn missing_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| !Path::new(p).exists())
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            reveal_in_finder,
            path_exists,
            missing_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
