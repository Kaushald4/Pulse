//! Runs the vendored job-board scanner.
//!
//! The provider modules are Node ESM: they discover themselves with
//! `readdirSync` and fetch cross-origin, so neither the webview nor Rust can
//! run them. Node already has to be installed for helmsman, so the scan is
//! handed to it exactly the same way.
//!
//! The scanner reports each entry as it finishes on stderr; those lines are
//! forwarded to the UI as `job-scan-progress`, so a scan shows which board it is
//! on rather than an opaque spinner.

use crate::support::node::{node_available, run_node_script, PROGRESS_PREFIX};
use crate::support::proc::parse_json_lenient;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

/// `jobs/scan.mjs`, from the repo in dev and from bundled resources when
/// installed.
fn scanner_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("jobs")
        .join("scan.mjs");
    if dev.is_file() {
        return dev
            .canonicalize()
            .map_err(|error| format!("Could not resolve the job scanner: {error}"));
    }

    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not locate app resources: {error}"))?
        .join("jobs")
        .join("scan.mjs");
    if bundled.is_file() {
        return Ok(bundled);
    }

    Err("Pulse could not find its job scanner (jobs/scan.mjs).".to_string())
}

/// Scans every entry and returns one result per entry, including per-entry
/// errors so one dead board can't fail the whole run.
#[tauri::command]
pub async fn scan_job_providers(
    app: tauri::AppHandle,
    entries: serde_json::Value,
    max_pages: Option<u32>,
) -> Result<serde_json::Value, String> {
    if !node_available() {
        return Err("Job scanning needs Node.js 20 or newer on your PATH.".to_string());
    }

    let script = scanner_script(&app)?;
    let payload = serde_json::json!({ "entries": entries, "maxPages": max_pages }).to_string();
    let handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let sink = move |line: &str| {
            let Some(progress) = line.strip_prefix(PROGRESS_PREFIX) else {
                return;
            };
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(progress) {
                let _ = handle.emit("job-scan-progress", value);
            }
        };
        let run = run_node_script(&script, &payload, &sink)?;

        if !run.success {
            let tail = run.stderr_tail.trim();
            return Err(format!(
                "Job scan failed: {}",
                if tail.is_empty() { "unknown error" } else { tail }
            ));
        }

        parse_json_lenient(&run.stdout, "job scan")
    })
    .await
    .map_err(|error| format!("Job scan task failed: {error}"))?
}
