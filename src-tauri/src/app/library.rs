use std::fs;
use tauri_plugin_dialog::DialogExt;

/// Writes a JSON library export to a path the user picks.
///
/// All database work stays on the TypeScript side; this only owns the native
/// save dialog and the file write. Returns the chosen path, or `None` when the
/// user cancels.
#[tauri::command]
pub async fn export_library(app: tauri::AppHandle, json: String) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Export Pulse library")
        .set_file_name("pulse-library.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file();

    let Some(path) = picked else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|e| format!("Unsupported save location: {e}"))?;

    fs::write(&path, json).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Reads a JSON library export from a path the user picks. Parsing and
/// validation happen in TypeScript.
#[tauri::command]
pub async fn import_library(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Import Pulse library")
        .add_filter("JSON", &["json"])
        .blocking_pick_file();

    let Some(path) = picked else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|e| format!("Unsupported file location: {e}"))?;

    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))
}
