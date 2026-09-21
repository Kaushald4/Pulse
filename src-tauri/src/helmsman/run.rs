//! Running the CLI.
//!
//! One capability call, which the reader and the scanner both go through, and
//! the status the UI reads to show whether the engine is ready.

use crate::support::node::node_available;
use crate::support::proc::parse_json_lenient;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::resolve::{resolve, resolve_path, version_for, SOURCE_MANAGED};

fn is_script(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("js") | Some("mjs") | Some("cjs")
    )
}

pub(super) fn build_command(binary: &str, command: &str) -> Command {
    let path = Path::new(binary);
    let mut cmd = if is_script(path) {
        // The managed bundle is a JS entry point, so it runs through Node. Use
        // the resolved binary rather than the bare name: a Finder-launched app
        // does not inherit the shell's PATH, so "node" alone would not be found
        // even on a machine where Node is installed.
        let node = crate::support::node::resolve_node().unwrap_or_else(|| PathBuf::from("node"));
        let mut node_cmd = crate::support::proc::command(node);
        node_cmd.arg(path);
        node_cmd
    } else {
        crate::support::proc::command(path)
    };
    cmd.arg(command);
    cmd
}

/// Runs a helmsman capability and returns its parsed JSON output.
///
/// This is `async` on purpose: Tauri executes non-async commands on the main
/// thread, and `Command::output()` waits for a full browser launch - which
/// froze the whole UI. The blocking call runs on the blocking pool instead.
#[tauri::command]
pub async fn run_helmsman_extract(
    command: String,
    args: Vec<String>,
) -> Result<serde_json::Value, String> {
    let binary = resolve_path().ok_or_else(|| {
        "helmsman is not installed. Open Settings and click \"Install helmsman\".".to_string()
    })?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = build_command(&binary, &command);
        for arg in &args {
            cmd.arg(arg);
        }

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to run helmsman: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stderr = stderr.trim();
            return Err(format!(
                "helmsman {command} failed: {}",
                if stderr.is_empty() { "unknown error" } else { stderr }
            ));
        }

        parse_json_lenient(&String::from_utf8_lossy(&output.stdout), "helmsman")
    })
    .await
    .map_err(|e| format!("helmsman task failed: {e}"))?
}

/// Reports the installed CLI so the UI can show whether it is ready.
#[tauri::command]
pub fn helmsman_status() -> serde_json::Value {
    let resolution = resolve();
    let version = resolution.path.as_deref().and_then(version_for);

    serde_json::json!({
        "path": resolution.path.map(|path| path.to_string_lossy().to_string()),
        "source": resolution.source,
        "managed": resolution.source == SOURCE_MANAGED,
        "version": version,
        "node": node_available(),
    })
}
