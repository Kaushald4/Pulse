//! Finding the helmsman CLI.
//!
//! Three ways in, in order: the managed install under ~/.pulse, a system
//! install in a known directory, then the PATH. There is no user-facing path
//! setting: installing is the only way in.

use crate::support::proc::{env_dir, find_executable, path_dirs};
use std::fs;
use std::path::{Path, PathBuf};

/// Where `install_helmsman` unpacks the release bundle.
pub fn managed_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".pulse").join("helmsman"))
}

/// The managed bundle's CLI entry point.
pub fn managed_entry() -> Option<PathBuf> {
    managed_dir().map(|dir| dir.join("dist").join("cli.js"))
}

/// Directories a global install commonly lands in.
///
/// Split by platform: the Unix list is meaningless on Windows, where global npm
/// binaries live under `%APPDATA%\npm`.
fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".bun").join("bin"));
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join("bin"));
    }

    if cfg!(windows) {
        if let Some(appdata) = env_dir("APPDATA") {
            dirs.push(appdata.join("npm"));
        }
        if let Some(local) = env_dir("LOCALAPPDATA") {
            dirs.push(local.join("Programs").join("helmsman"));
        }
    } else {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }

    dirs
}

pub const SOURCE_MANAGED: &str = "managed";
pub const SOURCE_PATH: &str = "path";
pub const SOURCE_NONE: &str = "none";

pub struct Resolution {
    pub path: Option<PathBuf>,
    pub source: &'static str,
}

/// Reads a version from the nearest package.json above an entry point.
pub fn version_for(entry: &Path) -> Option<String> {
    let mut current = entry.parent();
    for _ in 0..3 {
        let dir = current?;
        if let Ok(raw) = fs::read_to_string(dir.join("package.json")) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(version) = value.get("version").and_then(|v| v.as_str()) {
                    return Some(version.to_string());
                }
            }
        }
        current = dir.parent();
    }
    None
}

/// Resolves the CLI: the managed install, then a system install, then PATH.
/// There is no user-facing path setting - installing is the only way in.
pub fn resolve() -> Resolution {
    if let Some(entry) = managed_entry().filter(|entry| entry.is_file()) {
        return Resolution { path: Some(entry), source: SOURCE_MANAGED };
    }

    if let Some(found) = find_executable(&candidate_dirs(), "helmsman") {
        return Resolution { path: Some(found), source: SOURCE_PATH };
    }

    if let Some(found) = find_executable(&path_dirs(), "helmsman") {
        return Resolution { path: Some(found), source: SOURCE_PATH };
    }

    Resolution { path: None, source: SOURCE_NONE }
}

/// Convenience wrapper for callers that only need the path.
pub fn resolve_path() -> Option<String> {
    resolve()
        .path
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    #[test]
    fn version_for_reads_the_package_json_above_the_entry() {
        let dir = scratch("pulse-helmsman-test-version");
        fs::create_dir_all(dir.join("dist")).expect("create dist");
        fs::write(
            dir.join("package.json"),
            br#"{"name":"helmsman-cli","version":"9.9.9"}"#,
        )
        .expect("write package.json");
        let cli = dir.join("dist").join("cli.js");
        fs::write(&cli, b"// cli").expect("write cli");

        assert_eq!(version_for(&cli), Some("9.9.9".to_string()));

        let _ = fs::remove_dir_all(&dir);
    }
}
