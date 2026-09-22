//! Chrome profiles.
//!
//! Signing in has to happen in a real browser window rather than an automated
//! one, so this launches Chrome against a dedicated profile directory.

use std::fs;
use std::path::PathBuf;

use tauri::Emitter;

use crate::support::proc::env_dir;

use super::resolve::resolve_path;
use super::run::build_command;

#[tauri::command]
pub fn check_profile_status(profile: String) -> bool {
    dirs::home_dir()
        .map(|home| home.join(".helmsman").join("profiles").join(&profile).exists())
        .unwrap_or(false)
}

/// Rejects anything that could point outside the profiles directory.
fn valid_profile_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
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
///
/// This returns as soon as Chrome starts, so on its own the frontend has no way
/// of knowing when a login finished. The child is kept and watched here
/// instead, and `profile-login-finished` is emitted once it exits, which is the
/// moment the profile can be re-checked. Chrome can hold the profile lock past
/// its window closing, so the lock is released before that event, otherwise the
/// sync that follows a login runs into a locked profile.
#[tauri::command]
pub fn launch_auth_login(
    app: tauri::AppHandle,
    profile: String,
    site: String,
) -> Result<String, String> {
    let url = if site.starts_with("http") {
        site.clone()
    } else {
        format!("https://{site}")
    };

    let home = dirs::home_dir().ok_or_else(|| "Could not locate home directory".to_string())?;
    let profile_dir = home.join(".helmsman").join("profiles").join(&profile);

    if let Some(chrome) = chrome_candidates().into_iter().find(|p| p.exists()) {
        let mut child = crate::support::proc::command(chrome)
            .arg(format!("--user-data-dir={}", profile_dir.display()))
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to launch Chrome: {e}"))?;

        let watched = profile.clone();
        std::thread::spawn(move || {
            let _ = child.wait();
            close_profile(&watched);
            let _ = app.emit("profile-login-finished", watched);
        });

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

/// Releases a profile lock so the next run can use it.
///
/// helmsman holds a lock for as long as a browser has the profile open, and
/// Chrome can outlive its own window, so this is called explicitly rather than
/// waiting for the process to be gone.
fn close_profile(profile: &str) {
    if let Some(binary) = resolve_path() {
        let mut cmd = build_command(&binary, "auth");
        cmd.arg("close").arg(profile);
        let _ = cmd.output();
    }
}

/// Closes the browser holding this profile and releases its lock.
///
/// This is what ends a login window. On macOS closing a Chrome window does not
/// end the process, so it keeps running and keeps the profile locked, which
/// means "the login window went away" is not something a flow can watch for.
/// The user saying they are done is the signal, and this is what acts on it:
/// the browser closes and the verification sync can open the profile.
#[tauri::command]
pub async fn close_profile_browser(profile: String) -> Result<(), String> {
    let name = profile.trim().to_string();
    if !valid_profile_name(&name) {
        return Err("Invalid profile name.".to_string());
    }
    let _ = tauri::async_runtime::spawn_blocking(move || close_profile(&name)).await;
    Ok(())
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
    if !valid_profile_name(&name) {
        return Err("Invalid profile name.".to_string());
    }

    let dir = dirs::home_dir()
        .ok_or_else(|| "Could not locate home directory".to_string())?
        .join(".helmsman")
        .join("profiles")
        .join(&name);

    if resolve_path().is_some() {
        let name = name.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || close_profile(&name)).await;
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

#[cfg(test)]
mod tests {
    use super::valid_profile_name;

    #[test]
    fn profile_names_cannot_escape_the_profiles_directory() {
        assert!(valid_profile_name("reddit"));
        assert!(valid_profile_name("x-com"));
        assert!(!valid_profile_name(""));
        assert!(!valid_profile_name("../secrets"));
        assert!(!valid_profile_name("a/b"));
        assert!(!valid_profile_name(r"a\b"));
    }
}
