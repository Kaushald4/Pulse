//! First-run setup.
//!
//! Pulse leans on things it cannot bundle: Node (helmsman is a Node CLI) and,
//! optionally, Python with Scrapling for pages that need a real render. Rather
//! than letting each of those fail later with a raw shell error, the app runs
//! this once on first launch and installs them while showing what it is doing.
//!
//! On Windows Node and Python are fetched and installed silently, per-user and
//! without elevation. The other platforms still leave them to the user (Homebrew,
//! the distro packages), so those entries report "install it by hand".
//!
//! Every component is a row in [`COMPONENTS`], so adding the next dependency is
//! a new entry plus one `install_*` arm - not another special case in the UI.

use crate::config;
use crate::helmsman;
use crate::node::{self, node_available, node_version};
use crate::proc::run_streaming;
use crate::python;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

/// The event the installer streams to the window.
const PROGRESS_EVENT: &str = "setup-progress";

/// The extras Scrapling needs for the reader path we use.
const SCRAPLING_PACKAGE: &str = "scrapling[rag]";

/// The Node release the Windows installer fetches. Node's dist publishes a
/// standalone `node.exe` per architecture, so there is no MSI and no elevation.
#[cfg(windows)]
const NODE_VERSION: &str = "24.21.0";

/// The Python release the Windows installer fetches. Pinned to the newest 3.12
/// patch that still ships a Windows installer - 3.12.11 and later are source-only.
#[cfg(windows)]
const PYTHON_VERSION: &str = "3.12.10";

#[derive(Clone, Copy)]
struct Component {
    id: &'static str,
    title: &'static str,
    detail: &'static str,
    /// A missing required component blocks the app; a missing optional one does not.
    required: bool,
    /// Shown when Pulse cannot install this itself.
    manual: Option<&'static str>,
}

const COMPONENTS: &[Component] = &[
    Component {
        id: "node",
        title: "Node.js",
        detail: "Runs helmsman and the job-board scanner.",
        required: true,
        manual: Some("https://nodejs.org/en/download"),
    },
    Component {
        id: "helmsman",
        title: "helmsman",
        detail: "The extraction engine: browser profiles, feeds, per-site readers.",
        required: true,
        manual: None,
    },
    Component {
        id: "python",
        title: "Python 3",
        detail: "Interpreter the optional Scrapling reader runs in.",
        required: false,
        manual: Some("https://www.python.org/downloads/"),
    },
    Component {
        id: "scrapling",
        title: "Scrapling",
        detail: "Optional reader for pages that only render with JavaScript.",
        required: false,
        manual: None,
    },
];

/* -------------------------------------------------------------------------- */
/* Marker                                                                      */
/* -------------------------------------------------------------------------- */

fn marker_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".pulse").join("setup.json"))
}

/// Whether the installer has already run to completion (or been dismissed).
fn has_run() -> bool {
    marker_path().map(|path| path.is_file()).unwrap_or(false)
}

fn write_marker(value: Value) -> Result<(), String> {
    let path = marker_path().ok_or_else(|| "Could not locate home directory".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    fs::write(&path, raw).map_err(|error| format!("Could not write {}: {error}", path.display()))
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/* -------------------------------------------------------------------------- */
/* Detecting what is already there                                             */
/* -------------------------------------------------------------------------- */

/// The private environment the installer creates when the system Python will not
/// take packages (Homebrew and Debian both refuse by default).
fn venv_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".pulse").join("venv"))
        .ok_or_else(|| "Could not locate home directory".to_string())
}

/// Where a venv keeps its interpreter.
fn venv_python(dir: &Path) -> PathBuf {
    if cfg!(windows) {
        dir.join("Scripts").join("python.exe")
    } else {
        dir.join("bin").join("python3")
    }
}

fn command_output(program: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// The Scrapling version in the interpreter Pulse would actually use.
fn scrapling_version() -> Option<String> {
    let python = python::resolve()?;
    command_output(&python, &["-c", "import scrapling; print(scrapling.__version__)"])
}

fn helmsman_version() -> Option<String> {
    helmsman::resolve()
        .path
        .as_deref()
        .and_then(helmsman::version_for)
}

/// Everything known about one component right now.
fn inspect(id: &str) -> (bool, Option<String>) {
    match id {
        "node" => (node_available(), node_version()),
        "helmsman" => {
            let version = helmsman_version();
            (version.is_some(), version)
        }
        "python" => {
            let version = python::version();
            (version.is_some(), version)
        }
        "scrapling" => {
            let version = scrapling_version();
            (version.is_some(), version)
        }
        _ => (false, None),
    }
}

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

fn run_checked(
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

/// The architecture suffix Node's download URLs use (`win-x64`, `win-arm64`).
#[cfg(windows)]
fn node_arch() -> Result<&'static str, String> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("x64"),
        "aarch64" => Ok("arm64"),
        other => Err(format!("There is no automatic Node.js install for {other}.")),
    }
}

/// The architecture suffix Python's installer uses (`amd64`, `arm64`).
#[cfg(windows)]
fn python_arch() -> Result<&'static str, String> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("amd64"),
        "aarch64" => Ok("arm64"),
        other => Err(format!("There is no automatic Python install for {other}.")),
    }
}

/// Fetches a URL to `dest`, creating its parent directory.
#[cfg(windows)]
async fn download(url: &str, dest: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("pulse-desktop")
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Download failed with HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Could not read download: {e}"))?;

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }
    fs::write(dest, &bytes).map_err(|e| format!("Could not save {}: {e}", dest.display()))?;
    Ok(())
}

/// Installs Node on Windows.
///
/// A single download into `~/.pulse/node`: Node's dist serves a standalone
/// `node.exe` per architecture, so there is no MSI and no elevation. `node.rs`
/// already searches that directory, so the binary is picked up at once without
/// touching the PATH this process was started with.
#[cfg(windows)]
async fn install_node(on_line: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
    let arch = node_arch()?;
    let dir = node::managed_dir().ok_or_else(|| "Could not locate home directory".to_string())?;
    let target = dir.join("node.exe");

    on_line(&format!("Downloading Node.js v{NODE_VERSION} ({arch})…"));
    download(
        &format!("https://nodejs.org/dist/v{NODE_VERSION}/win-{arch}/node.exe"),
        &target,
    )
    .await?;

    if node::node_version().is_none() {
        return Err("The downloaded Node.js binary did not run.".to_string());
    }
    on_line(&format!("Installed to {}", target.display()));
    Ok(())
}

#[cfg(not(windows))]
async fn install_node(_on_line: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
    Err("Node.js has to be installed by hand.".to_string())
}

/// Installs Python on Windows.
///
/// The official python.org installer, run silently as a per-user install:
/// `InstallAllUsers=0` keeps it out of Program Files and needs no elevation, and
/// `PrependPath=1` puts it on the user's PATH for shells started later. This
/// process does not wait for that - `python.rs` probes the install directories.
#[cfg(windows)]
async fn install_python(on_line: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
    let arch = python_arch()?;
    let work = dirs::home_dir()
        .ok_or_else(|| "Could not locate home directory".to_string())?
        .join(".pulse")
        .join("tmp");
    let installer = work.join(format!("python-{PYTHON_VERSION}-{arch}.exe"));

    on_line(&format!("Downloading Python {PYTHON_VERSION} ({arch})…"));
    download(
        &format!(
            "https://www.python.org/ftp/python/{PYTHON_VERSION}/python-{PYTHON_VERSION}-{arch}.exe"
        ),
        &installer,
    )
    .await?;

    on_line("Installing Python (per-user, no admin needed)…");
    let outcome = run_checked(
        on_line,
        &installer,
        &[
            "/quiet".to_string(),
            "InstallAllUsers=0".to_string(),
            "PrependPath=1".to_string(),
            "Include_launcher=1".to_string(),
            "Include_test=0".to_string(),
        ],
    );
    let _ = fs::remove_file(&installer);
    outcome?;

    if python::version().is_none() {
        return Err("Python was installed but no interpreter could be found.".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
async fn install_python(_on_line: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
    Err("Python 3 has to be installed by hand.".to_string())
}

/// Installs Scrapling.
///
/// A private venv rather than the system interpreter: Homebrew's Python and
/// Debian's both refuse `pip install` outside a venv (PEP 668), and writing into
/// the user's global site-packages to work around that would be rude. The app's
/// `extraction.pythonPath` then points at the venv, so the reader finds it.
fn install_scrapling(on_line: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
    let dir = venv_dir()?;
    let interpreter = venv_python(&dir);

    if !interpreter.is_file() {
        let python = python::resolve()
            .ok_or_else(|| "Python 3 is not installed, so Scrapling was skipped.".to_string())?;
        on_line(&format!(
            "Creating a private Python environment in {}",
            dir.display()
        ));
        run_checked(
            on_line,
            &python,
            &[
                "-m".to_string(),
                "venv".to_string(),
                dir.to_string_lossy().to_string(),
            ],
        )?;
    }

    run_checked(
        on_line,
        &interpreter,
        &[
            "-m".to_string(),
            "pip".to_string(),
            "install".to_string(),
            "--upgrade".to_string(),
            // A carriage-return progress bar is unreadable as a log line.
            "--progress-bar".to_string(),
            "off".to_string(),
            SCRAPLING_PACKAGE.to_string(),
        ],
    )?;

    if !interpreter.is_file() {
        return Err("The virtual environment did not produce an interpreter.".to_string());
    }

    // Only claim the interpreter if the user has not set one themselves.
    let mut config = config::load_file();
    if config.extraction.python_path.trim().is_empty() {
        config.extraction.python_path = interpreter.to_string_lossy().to_string();
        config::save(&config)?;
        on_line(&format!(
            "Pointed Settings → Article reading at {}",
            interpreter.display()
        ));
    }

    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_component_has_a_unique_id() {
        let mut ids: Vec<&str> = COMPONENTS.iter().map(|component| component.id).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "component ids must be unique");
    }

    #[test]
    fn each_component_knows_how_to_inspect_itself() {
        for component in COMPONENTS {
            // Must not panic on a machine where the component is absent.
            let (ready, version) = inspect(component.id);
            assert!(
                !ready || version.is_some(),
                "{} reported ready without a version",
                component.id
            );
        }
    }

    #[test]
    fn an_unknown_component_reports_nothing() {
        assert_eq!(inspect("nope"), (false, None));
    }

    #[test]
    fn the_venv_interpreter_sits_where_the_platform_keeps_it() {
        let interpreter = venv_python(Path::new("/tmp/pulse-venv"));
        assert!(interpreter.starts_with("/tmp/pulse-venv"));
        if cfg!(windows) {
            assert!(interpreter.ends_with("Scripts/python.exe"));
        } else {
            assert!(interpreter.ends_with("bin/python3"));
        }
    }
}
