//! Chrome profiles.
//!
//! Signing in has to happen in a real browser window rather than an automated
//! one, so this launches Chrome against a dedicated profile directory.

use std::fs;
use std::path::PathBuf;

use crate::support::proc::env_dir;

use super::resolve::resolve_path;
use super::run::build_command;

#[tauri::command]
pub fn check_profile_status(profile: String) -> bool {
    dirs::home_dir()
        .map(|home| home.join(".helmsman").join("profiles").join(&profile).exists())
        .unwrap_or(false)
}

fn chrome_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if cfg!(windows) {
        if let Some(local) = env_dir("LOCALAPPDATA") {
            candidates.push(
                local
                    .join("Google")
                    .join("Chrome")
                    .join("Application")
                    .join("chrome.exe"),
            );
        }
        candidates.push(PathBuf::from(
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        ));
        candidates.push(PathBuf::from(
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ));
        return candidates;
    }

    if let Some(home) = dirs::home_dir() {
        candidates.push(
            home.join("Applications")
                .join("Google Chrome.app")
                .join("Contents")
                .join("MacOS")
                .join("Google Chrome"),
        );
    }
    candidates.push(PathBuf::from(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ));
    candidates.push(PathBuf::from("/usr/bin/google-chrome"));
    candidates.push(PathBuf::from("/usr/bin/chromium"));
    candidates
}

/// Launches a real Chrome instance (outside automation) so the user can log in
/// safely, falling back to `helmsman auth login`.
#[tauri::command]
pub fn launch_auth_login(profile: String, site: String) -> Result<String, String> {
    let url = if site.starts_with("http") {
        site.clone()
    } else {
        format!("https://{site}")
    };

    let home = dirs::home_dir().ok_or_else(|| "Could not locate home directory".to_string())?;
    let profile_dir = home.join(".helmsman").join("profiles").join(&profile);

    if let Some(chrome) = chrome_candidates().into_iter().find(|p| p.exists()) {
        crate::support::proc::command(chrome)
            .arg(format!("--user-data-dir={}", profile_dir.display()))
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to launch Chrome: {e}"))?;
        return Ok(format!("Launched Chrome with profile '{profile}' for {site}"));
    }

    if let Some(binary) = resolve_path() {
        let mut cmd = build_command(&binary, "auth");
        cmd.arg("login").arg(&profile).arg("--site").arg(&site);
        cmd.spawn()
            .map_err(|e| format!("Failed to launch helmsman auth: {e}"))?;
        return Ok(format!("Launched helmsman auth for {site}"));
    }

    Err("Could not find Google Chrome or the helmsman CLI to launch login.".to_string())
}

/// Removes a saved browser profile - this is what actually signs a source out.
///
/// helmsman stores each profile as a directory under `~/.helmsman/profiles`, so
/// deleting it discards the cookies and local storage. `helmsman auth close`
/// runs first so an open Chrome releases its lock instead of us deleting a
/// profile out from under a live browser.
#[tauri::command]
pub async fn disconnect_profile(profile: String) -> Result<serde_json::Value, String> {
    let name = profile.trim().to_string();
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
    {
        return Err("Invalid profile name.".to_string());
    }

    let dir = dirs::home_dir()
        .ok_or_else(|| "Could not locate home directory".to_string())?
        .join(".helmsman")
        .join("profiles")
        .join(&name);

    if let Some(binary) = resolve_path() {
        let name = name.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let mut cmd = build_command(&binary, "auth");
            cmd.arg("close").arg(&name);
            let _ = cmd.output();
        })
        .await;
    }

    let removed = if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Could not delete {}: {e}", dir.display()))?;
        true
    } else {
        false
    };

    Ok(serde_json::json!({
        "removed": removed,
        "path": dir.to_string_lossy(),
    }))
}
