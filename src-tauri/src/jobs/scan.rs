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

use crate::support::node::{node_available, run_node_script_notify, PROGRESS_PREFIX};
use crate::support::proc::{parse_json_lenient, stop_process};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};

/// The scan currently running, so the UI can stop it.
///
/// A scan is a Node process doing dozens of network calls, which can outlast the
/// user's patience. Stopping means killing that process: it owns the requests,
/// and its results are only stored once it returns, so a stopped scan stores
/// nothing and leaves no half-written state behind.
#[derive(Clone, Default)]
pub struct JobScanState {
    pid: Arc<Mutex<Option<u32>>>,
    stopped: Arc<AtomicBool>,
}

impl JobScanState {
    fn begin(&self) {
        *self.pid.lock().expect("job scan lock poisoned") = None;
        self.stopped.store(false, Ordering::SeqCst);
    }

    fn set_pid(&self, pid: u32) {
        *self.pid.lock().expect("job scan lock poisoned") = Some(pid);
    }

    fn finish(&self) {
        *self.pid.lock().expect("job scan lock poisoned") = None;
    }

    fn was_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    fn stop(&self) -> Result<(), String> {
        let pid = *self.pid.lock().expect("job scan lock poisoned");
        let Some(pid) = pid else {
            return Err("No job scan is running.".to_string());
        };

        // Set before the kill, so the run that is about to fail can tell a
        // deliberate stop from a crash.
        self.stopped.store(true, Ordering::SeqCst);
        stop_process(pid)
    }
}

/// Stops the running scan. Returns an error only if nothing was running.
#[tauri::command]
pub fn cancel_job_scan(scan: State<'_, JobScanState>) -> Result<(), String> {
    scan.stop()
}

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
    scan: State<'_, JobScanState>,
) -> Result<serde_json::Value, String> {
    if !node_available() {
        return Err("Job scanning needs Node.js 20 or newer on your PATH.".to_string());
    }

    let script = scanner_script(&app)?;
    let payload = serde_json::json!({ "entries": entries, "maxPages": max_pages }).to_string();
    let handle = app.clone();
    // Cloned rather than borrowed: the state must not be held across the await.
    let scan = scan.inner().clone();
    let runner = scan.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let sink = move |line: &str| {
            let Some(progress) = line.strip_prefix(PROGRESS_PREFIX) else {
                return;
            };
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(progress) {
                let _ = handle.emit("job-scan-progress", value);
            }
        };

        runner.begin();
        let run = run_node_script_notify(&script, &payload, &sink, &|pid| runner.set_pid(pid));
        runner.finish();
        let run = run?;

        if !run.success {
            // A stop is the user's own doing, so it is reported as such rather
            // than dressed up as a failure with a stderr tail.
            if runner.was_stopped() {
                return Err("Job scan stopped.".to_string());
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stopping_with_nothing_running_is_an_error() {
        let scan = JobScanState::default();
        assert!(scan.stop().is_err());
        assert!(!scan.was_stopped(), "a stop that did nothing must not colour the next run");
    }

    #[test]
    fn begin_clears_the_previous_run() {
        let scan = JobScanState::default();
        scan.set_pid(4242);
        scan.stop().ok();
        assert!(scan.was_stopped());

        scan.begin();
        assert!(!scan.was_stopped(), "a new scan starts unstoppable and unstopped");
        assert!(scan.stop().is_err(), "and with no process to stop");
    }

    /// The whole point of the command: the scanner process really does die, so a
    /// scan cannot keep burning network calls after the user gave up on it.
    #[cfg(unix)]
    #[test]
    fn stopping_kills_the_running_process() {
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .expect("spawns a process to stop");

        let scan = JobScanState::default();
        scan.begin();
        scan.set_pid(child.id());

        scan.stop().expect("stops the process");

        let status = child.wait().expect("the process is reaped");
        assert!(!status.success(), "the process must not have finished on its own");
        assert!(scan.was_stopped(), "and the run must know why it ended");
    }
}
