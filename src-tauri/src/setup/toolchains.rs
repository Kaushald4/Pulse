//! Installing Node.js and Python where Pulse can do it itself.
//!
//! Only Windows has an automatic path: Node publishes a standalone node.exe and
//! the python.org installer runs per-user without elevation. On macOS and Linux
//! these return the "install it by hand" error, because Homebrew and the distro
//! package manager are the right tools there.

// Every import below is used only by the Windows installers. Gated rather than
// deleted, so the file still compiles everywhere without warning about imports
// the other platforms never reach.
#[cfg(windows)]
use crate::support::{node, python};
#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::path::Path;

#[cfg(windows)]
use super::flow::run_checked;

/// The Node release the Windows installer fetches. Node's dist publishes a
/// standalone `node.exe` per architecture, so there is no MSI and no elevation.
#[cfg(windows)]
const NODE_VERSION: &str = "24.21.0";

/// The Python release the Windows installer fetches. Pinned to the newest 3.12
/// patch that still ships a Windows installer - 3.12.11 and later are source-only.
#[cfg(windows)]
const PYTHON_VERSION: &str = "3.12.10";

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
pub(super) async fn install_node(on_line: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
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
pub(super) async fn install_node(_on_line: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
    Err("Node.js has to be installed by hand.".to_string())
}

/// Installs Python on Windows.
///
/// The official python.org installer, run silently as a per-user install:
/// `InstallAllUsers=0` keeps it out of Program Files and needs no elevation, and
/// `PrependPath=1` puts it on the user's PATH for shells started later. This
/// process does not wait for that - `python.rs` probes the install directories.
#[cfg(windows)]
pub(super) async fn install_python(on_line: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
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
pub(super) async fn install_python(_on_line: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
    Err("Python 3 has to be installed by hand.".to_string())
}
