//! The snapshot the macOS widget reads.
//!
//! The app and the widget extension share a group container, which is the only
//! place both are allowed to look. Nothing to write on other platforms, where the
//! snapshot is not part of the UI.

#[cfg(target_os = "macos")]
use std::fs;
#[cfg(target_os = "macos")]
use std::path::PathBuf;

#[tauri::command]
pub fn publish_widget_snapshot(snapshot: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let home =
            dirs::home_dir().ok_or_else(|| "Could not locate the home directory".to_string())?;
        let container = home.join("Library/Group Containers/group.com.pulse.desktop");
        fs::create_dir_all(&container).map_err(|error| error.to_string())?;
        let path: PathBuf = container.join("pulse-widget.json");
        fs::write(path, snapshot).map_err(|error| error.to_string())?;
    }
    Ok(())
}
