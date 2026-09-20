//! Node.js helpers.
//!
//! Node runs helmsman and the job-board scanner. Both are plain Node programs
//! driven over stdout, so the process plumbing lives in [`crate::proc`] and this
//! module only knows about Node itself.

use std::path::Path;
use std::process::Command;

use crate::proc::{run_streaming, ProcRun};

pub use crate::proc::PROGRESS_PREFIX;

/// Whether `node` is reachable on the PATH.
pub fn node_available() -> bool {
    std::env::var_os("PATH")
        .map(|path| {
            std::env::split_paths(&path)
                .map(|dir| dir.join("node"))
                .any(|candidate| candidate.is_file())
        })
        .unwrap_or(false)
}

/// `node --version`, or nothing when Node is missing.
pub fn node_version() -> Option<String> {
    if !node_available() {
        return None;
    }
    let output = Command::new("node").arg("--version").output().ok()?;
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
    run_streaming(
        Path::new("node"),
        &[script.to_string_lossy().to_string()],
        Some(input),
        on_line,
    )
}
