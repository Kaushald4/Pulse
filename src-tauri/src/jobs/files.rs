//! Native pickers for resumes and generated documents.
//!
//! Parsing and rendering stay on the TypeScript side - this only owns the
//! dialog and the bytes, the same split `library.rs` uses.

use base64::Engine as _;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub name: String,
    pub mime_type: String,
    pub base64: String,
}

/// The three resume formats the parser understands.
fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("pdf") => "application/pdf",
        Some("docx") => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }
        _ => "text/plain",
    }
}

/// Opens a picker filtered to resume formats and returns the file's bytes.
#[tauri::command]
pub async fn pick_resume_file(app: tauri::AppHandle) -> Result<Option<PickedFile>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Choose your base resume")
        .add_filter("Resume", &["pdf", "docx", "txt", "md"])
        .blocking_pick_file();

    let Some(path) = picked else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| format!("Unsupported file location: {error}"))?;

    let bytes =
        std::fs::read(&path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;

    Ok(Some(PickedFile {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "resume".to_string()),
        mime_type: mime_for(&path).to_string(),
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    }))
}

/// Writes a generated file (tailored resume, cover letter) where the user picks.
#[tauri::command]
pub async fn save_job_file(
    app: tauri::AppHandle,
    file_name: String,
    base64_data: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Save document")
        .set_file_name(&file_name)
        .blocking_save_file();

    let Some(path) = picked else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| format!("Unsupported save location: {error}"))?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|error| format!("Could not decode the document: {error}"))?;

    std::fs::write(&path, bytes)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    Ok(Some(path.to_string_lossy().to_string()))
}
