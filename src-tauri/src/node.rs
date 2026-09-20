//! Node.js helpers.
//!
//! Node runs helmsman and the job-board scanner. Both are plain Node programs
//! driven over stdout, so the process plumbing lives in [`crate::proc`] and this
//! module only knows about Node itself.
//!
//! Finding Node is the subtle part. A desktop app launched from Finder or the
//! Dock does not inherit the shell's PATH - macOS hands it a minimal one - so an
//! nvm, Volta or Homebrew install is invisible to it even though `node` works
//! perfectly in a terminal. That is why the bare name is never used: everything
//! resolves to a real path first, and only then runs.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::proc::{env_dir, find_executable, path_dirs, run_streaming, ProcRun};

pub use crate::proc::PROGRESS_PREFIX;

/// Sort key for an nvm version directory, so "v9" does not outrank "v24".
fn version_key(dir: &Path) -> Vec<u32> {
    dir.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .trim_start_matches('v')
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

/// The `bin` directory of every nvm-installed Node, newest first.
fn nvm_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let versions = home.join(".nvm").join("versions").join("node");
    let Ok(entries) = std::fs::read_dir(&versions) else {
        return Vec::new();
    };

    let mut installed: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();

    installed.sort_by_key(|dir| std::cmp::Reverse(version_key(dir)));
    installed.into_iter().map(|dir| dir.join("bin")).collect()
}

/// Everywhere a Node install ends up when it is not on the process PATH.
fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(home) = dirs::home_dir() {
        dirs.extend(nvm_bin_dirs(&home));
        dirs.push(home.join(".volta").join("bin"));
        dirs.push(home.join(".fnm").join("aliases").join("default").join("bin"));
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join("bin"));
    }

    if cfg!(windows) {
        if let Some(appdata) = env_dir("APPDATA") {
            dirs.push(appdata.join("npm"));
        }
        if let Some(program_files) = env_dir("ProgramFiles") {
            dirs.push(program_files.join("nodejs"));
        }
    } else {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin"));
    }

    dirs
}

/// The Node binary: the PATH first, then the usual install locations.
///
/// Re-resolved on every call rather than cached, so installing Node while the
/// app is open is picked up without a restart.
pub fn resolve_node() -> Option<PathBuf> {
    find_executable(&path_dirs(), "node").or_else(|| find_executable(&candidate_dirs(), "node"))
}

/// Whether Node can be found anywhere.
pub fn node_available() -> bool {
    resolve_node().is_some()
}

/// `node --version`, or nothing when Node is missing.
pub fn node_version() -> Option<String> {
    let node = resolve_node()?;
    let output = Command::new(node).arg("--version").output().ok()?;
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

/// Runs a Node script, handing every stderr line to `on_line` as it arrives.
pub fn run_node_script(
    script: &Path,
    input: &str,
    on_line: &(dyn Fn(&str) + Send + Sync),
) -> Result<ProcRun, String> {
    let node = resolve_node()
        .ok_or_else(|| "Node.js was not found, so the script cannot run.".to_string())?;

    run_streaming(
        &node,
        &[script.to_string_lossy().to_string()],
        Some(input),
        on_line,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nvm_versions_sort_numerically_not_lexically() {
        // Lexically "v9" beats "v24", which would pick an ancient Node.
        let mut dirs = vec![
            PathBuf::from("/home/u/.nvm/versions/node/v9.11.2"),
            PathBuf::from("/home/u/.nvm/versions/node/v24.13.1"),
            PathBuf::from("/home/u/.nvm/versions/node/v20.11.0"),
        ];
        dirs.sort_by_key(|dir| std::cmp::Reverse(version_key(dir)));

        let names: Vec<String> = dirs
            .iter()
            .map(|dir| dir.file_name().unwrap_or_default().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["v24.13.1", "v20.11.0", "v9.11.2"]);
    }

    #[test]
    fn a_resolved_node_is_a_real_binary_that_runs() {
        // The bug this guards: reporting a path that cannot actually be executed.
        let Some(node) = resolve_node() else {
            return; // no Node on this machine; nothing to assert
        };
        assert!(node.is_file(), "resolved a path that does not exist");
        assert!(
            node_version().is_some(),
            "resolved {} but `--version` produced nothing",
            node.display()
        );
    }
}
