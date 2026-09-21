//! The installer run: what is missing, and installing it while streaming progress.

use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Emitter};

use crate::helmsman;
use crate::support::proc::run_streaming;
use crate::support::python;

use super::components::{has_run, inspect, now_seconds, write_marker, COMPONENTS};
use super::toolchains::{install_node, install_python};
use super::venv::{install_scrapling, venv_dir, venv_python};

/// The event the installer streams to the window.
const PROGRESS_EVENT: &str = "setup-progress";

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

#[tauri::command]
pub fn setup_status() -> Value {
    let steps: Vec<Value> = COMPONENTS
        .iter()
        .map(|component| {
            let (ready, version) = inspect(component.id);
            json!({
                "id": component.id,
                "title": component.title,
                "detail": component.detail,
                "required": component.required,
                "manual": component.manual,
                "ready": ready,
                "version": version,
            })
        })
        .collect();

    let missing_required = steps
        .iter()
        .any(|step| step["required"] == json!(true) && step["ready"] == json!(false));

    json!({
        "complete": has_run(),
        "missingRequired": missing_required,
        "venv": venv_python(&venv_dir().unwrap_or_default()).exists(),
        "steps": steps,
    })
}

/// Records that the user chose to move on. The wizard does not nag twice.
#[tauri::command]
pub fn dismiss_setup() -> Result<(), String> {
    write_marker(json!({ "dismissedAt": now_seconds() }))
}

/* -------------------------------------------------------------------------- */
/* Installing                                                                  */
/* -------------------------------------------------------------------------- */

fn emit(app: &AppHandle, step: &str, status: &str, text: &str) {
    let _ = app.emit(
        PROGRESS_EVENT,
        json!({ "step": step, "status": status, "text": text }),
    );
}

/// Sends one line of a command's own output to the window.
fn teed(app: &AppHandle, step: &'static str) -> impl Fn(&str) + Send + Sync + 'static {
    let handle = app.clone();
    move |line: &str| {
        if !line.trim().is_empty() {
            emit(&handle, step, "line", line);
        }
    }
}

pub(super) fn run_checked(
    on_line: &(dyn Fn(&str) + Send + Sync),
    program: &Path,
    args: &[String],
) -> Result<(), String> {
    let command_line = format!(
        "{} {}",
        program.file_name().unwrap_or_default().to_string_lossy(),
        args.join(" ")
    );
    on_line(&format!("$ {command_line}"));

    let program = program.to_path_buf();
    let args = args.to_vec();
    let outcome = run_streaming(&program, &args, None, on_line)?;

    if outcome.success {
        Ok(())
    } else {
        let tail = outcome.stderr_tail.trim();
        Err(if tail.is_empty() {
            format!("{command_line} failed")
        } else {
            tail.lines().last().unwrap_or(tail).to_string()
        })
    }
}

/// Runs everything that is missing, streaming each step as it happens.
#[tauri::command]
pub async fn run_setup(app: AppHandle) -> Result<Value, String> {
    let mut results: Vec<Value> = Vec::new();

    for component in COMPONENTS {
        let (ready, version) = inspect(component.id);

        if ready {
            emit(
                &app,
                component.id,
                "skip",
                &format!(
                    "{} is already installed{}",
                    component.title,
                    version.map(|v| format!(" ({v})")).unwrap_or_default()
                ),
            );
            results.push(json!({ "id": component.id, "status": "ready", "required": component.required }));
            continue;
        }

        // Scrapling is the one component that needs another first. Without an
        // interpreter there is nothing to install it into, and running the bare
        // `python` name on Windows would only surface the Microsoft Store's "not
        // found" advert as if it were Scrapling's error. Skip it instead.
        if component.id == "scrapling" && python::resolve().is_none() {
            emit(
                &app,
                "scrapling",
                "skip",
                "Python 3 is not installed, so Scrapling was skipped.",
            );
            results.push(json!({ "id": "scrapling", "status": "skipped", "required": false }));
            continue;
        }

        emit(&app, component.id, "start", &format!("Installing {}", component.title));

        let outcome: Result<(), String> = match component.id {
            "helmsman" => {
                helmsman::install_with_progress(&teed(&app, "helmsman")).await.map(|installed| {
                    let version = installed
                        .get("version")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    emit(&app, "helmsman", "line", &format!("Installed helmsman {version}"));
                })
            }
            "scrapling" => {
                let sink = teed(&app, "scrapling");
                install_scrapling(&sink)
            }
            "node" => install_node(&teed(&app, "node")).await,
            "python" => install_python(&teed(&app, "python")).await,
            other => Err(format!("No installer for {other}")),
        };

        match outcome {
            Ok(()) => {
                let (_, version) = inspect(component.id);
                emit(
                    &app,
                    component.id,
                    "done",
                    &format!(
                        "{} ready{}",
                        component.title,
                        version.map(|v| format!(" ({v})")).unwrap_or_default()
                    ),
                );
                results.push(json!({ "id": component.id, "status": "installed", "required": component.required }));
            }
            Err(error) => {
                let message = if component.manual.is_some() {
                    format!("{error} Install it from {}", component.manual.unwrap_or_default())
                } else {
                    error
                };
                emit(&app, component.id, "failed", &message);
                results.push(json!({
                    "id": component.id,
                    "status": "failed",
                    "required": component.required,
                    "error": message,
                }));
            }
        }
    }

    let blocked = results.iter().any(|result| {
        result["required"] == json!(true) && result["status"] == json!("failed")
    });

    // A blocked run leaves no marker, so the wizard comes back next launch.
    if !blocked {
        write_marker(json!({ "completedAt": now_seconds(), "results": results }))?;
    }

    Ok(json!({ "blocked": blocked, "results": results }))
}
