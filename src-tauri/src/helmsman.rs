use crate::node::node_available;
use crate::proc::parse_json_lenient;
use flate2::read::GzDecoder;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

const HELMSMAN_REPO: &str = "Kaushald4/helmsman-cli";
const ASSET_PREFIX: &str = "helmsman-cli-";
const ASSET_SUFFIX: &str = ".tar.gz";
/// Guard against a runaway download; the real bundle is a few megabytes.
const MAX_ARCHIVE_BYTES: u64 = 200 * 1024 * 1024;

fn is_script(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("js") | Some("mjs") | Some("cjs")
    )
}

/// Where `install_helmsman` unpacks the release bundle.
pub fn managed_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".pulse").join("helmsman"))
}

/// The managed bundle's CLI entry point.
pub fn managed_entry() -> Option<PathBuf> {
    managed_dir().map(|dir| dir.join("dist").join("cli.js"))
}

fn candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local").join("bin").join("helmsman"));
        candidates.push(home.join(".bun").join("bin").join("helmsman"));
        candidates.push(home.join(".cargo").join("bin").join("helmsman"));
        candidates.push(home.join("bin").join("helmsman"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/helmsman"));
    candidates.push(PathBuf::from("/usr/local/bin/helmsman"));
    candidates
}

fn find_on_path() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join("helmsman"))
        .find(|candidate| candidate.is_file())
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

    if let Some(found) = candidate_paths().into_iter().find(|p| p.is_file()) {
        return Resolution { path: Some(found), source: SOURCE_PATH };
    }

    if let Some(found) = find_on_path() {
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

fn build_command(binary: &str, command: &str) -> Command {
    let path = Path::new(binary);
    let mut cmd = if is_script(path) {
        let mut node = Command::new("node");
        node.arg(path);
        node
    } else {
        Command::new(path)
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

/// Extracts a .tar.gz, refusing entries that would escape the destination.
fn extract_tar_gz(archive: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| format!("Could not open archive: {e}"))?;
    let mut tar = tar::Archive::new(GzDecoder::new(file));

    let entries = tar
        .entries()
        .map_err(|e| format!("Could not read archive: {e}"))?;

    for entry in entries {
        let mut entry = entry.map_err(|e| format!("Corrupt archive entry: {e}"))?;
        let path = entry
            .path()
            .map_err(|e| format!("Corrupt archive path: {e}"))?
            .into_owned();

        let unsafe_path = path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, Component::ParentDir | Component::RootDir));

        if unsafe_path {
            return Err(format!("Archive contains an unsafe path: {}", path.display()));
        }

        let unpacked = entry
            .unpack_in(destination)
            .map_err(|e| format!("Could not extract {}: {e}", path.display()))?;
        if !unpacked {
            return Err(format!("Refused to extract {}", path.display()));
        }
    }

    Ok(())
}

/// Downloads the latest `helmsman-cli-*.tar.gz` release asset and installs it to
/// `~/.pulse/helmsman`, replacing any previous managed install.
///
/// Each stage is reported to `on_line`, so the first-run installer can show the
/// download and the extraction as they happen instead of a spinner.
pub async fn install_with_progress(
    on_line: &(dyn Fn(&str) + Send + Sync),
) -> Result<serde_json::Value, String> {
    on_line("Looking up the latest release on GitHub…");
    let home = dirs::home_dir().ok_or_else(|| "Could not locate home directory".to_string())?;
    let client = reqwest::Client::builder()
        .user_agent("pulse-desktop")
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;

    let release: serde_json::Value = client
        .get(format!(
            "https://api.github.com/repos/{HELMSMAN_REPO}/releases/latest"
        ))
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {e}"))?
        .json()
        .await
        .map_err(|e| format!("GitHub returned invalid JSON: {e}"))?;

    if let Some(message) = release.get("message").and_then(|v| v.as_str()) {
        return Err(format!("GitHub: {message}"));
    }

    let tag = release
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let asset = release
        .get("assets")
        .and_then(|v| v.as_array())
        .and_then(|assets| {
            assets.iter().find(|asset| {
                asset
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|name| name.starts_with(ASSET_PREFIX) && name.ends_with(ASSET_SUFFIX))
                    .unwrap_or(false)
            })
        })
        .ok_or_else(|| {
            format!(
                "Release {tag} has no {ASSET_PREFIX}*{ASSET_SUFFIX} asset. Publish one with the Release workflow."
            )
        })?;

    let asset_name = asset
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("asset")
        .to_string();
    let download_url = asset
        .get("browser_download_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Release asset has no download URL".to_string())?
        .to_string();

    if let Some(size) = asset.get("size").and_then(|v| v.as_u64()) {
        if size > MAX_ARCHIVE_BYTES {
            return Err(format!("Release asset is unexpectedly large ({size} bytes)."));
        }
        on_line(&format!(
            "Downloading {asset_name} ({:.1} MB)…",
            size as f64 / 1_048_576.0
        ));
    } else {
        on_line(&format!("Downloading {asset_name}…"));
    }

    let work = home.join(".pulse").join("tmp");
    fs::create_dir_all(&work).map_err(|e| format!("Could not create {}: {e}", work.display()))?;
    let archive_path = work.join("helmsman-download.tar.gz");
    let extract_dir = work.join("extract");

    let response = client
        .get(&download_url)
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
    fs::write(&archive_path, &bytes).map_err(|e| format!("Could not save archive: {e}"))?;
    on_line(&format!("Downloaded {asset_name} ({tag})"));

    let _ = fs::remove_dir_all(&extract_dir);
    fs::create_dir_all(&extract_dir).map_err(|e| format!("Could not prepare extract dir: {e}"))?;
    on_line("Extracting…");

    let staged_root = extract_dir.join("helmsman");
    let entry = staged_root.join("dist").join("cli.js");

    let install_result = (|| -> Result<(), String> {
        extract_tar_gz(&archive_path, &extract_dir)?;
        if !entry.is_file() {
            return Err("Archive did not contain helmsman/dist/cli.js".to_string());
        }

        let target = home.join(".pulse").join("helmsman");
        if target.exists() {
            fs::remove_dir_all(&target)
                .map_err(|e| format!("Could not replace the existing install: {e}"))?;
        }
        fs::rename(&staged_root, &target)
            .map_err(|e| format!("Could not install to {}: {e}", target.display()))?;
        Ok(())
    })();

    let _ = fs::remove_file(&archive_path);
    let _ = fs::remove_dir_all(&extract_dir);
    install_result?;

    let installed = managed_entry()
        .ok_or_else(|| "Install path could not be resolved".to_string())?
        .to_string_lossy()
        .to_string();

    let version = version_for(Path::new(&installed));
    on_line(&format!(
        "Installed to {installed}{}",
        version
            .as_deref()
            .map(|version| format!(" (helmsman {version})"))
            .unwrap_or_default()
    ));

    Ok(serde_json::json!({
        "path": installed,
        "version": version,
        "asset": asset_name,
        "node": node_available(),
    }))
}

/// The Settings button: the same install, with nothing listening to it.
#[tauri::command]
pub async fn install_helmsman() -> Result<serde_json::Value, String> {
    install_with_progress(&|_| {}).await
}

#[tauri::command]
pub fn check_profile_status(profile: String) -> bool {
    dirs::home_dir()
        .map(|home| home.join(".helmsman").join("profiles").join(&profile).exists())
        .unwrap_or(false)
}

fn chrome_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
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
#[tauri::command]
pub fn launch_auth_login(profile: String, site: String) -> Result<String, String> {
    let url = if site.starts_with("http") {
        site.clone()
    } else {
        format!("https://{site}")
    };

    let home = dirs::home_dir().ok_or_else(|| "Could not locate home directory".to_string())?;
    let profile_dir = home.join(".helmsman").join("profiles").join(&profile);

    if let Some(chrome) = chrome_candidates().into_iter().find(|p| p.exists()) {
        Command::new(chrome)
            .arg(format!("--user-data-dir={}", profile_dir.display()))
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to launch Chrome: {e}"))?;
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

/// Removes a saved browser profile - this is what actually signs a source out.
///
/// helmsman stores each profile as a directory under `~/.helmsman/profiles`, so
/// deleting it discards the cookies and local storage. `helmsman auth close`
/// runs first so an open Chrome releases its lock instead of us deleting a
/// profile out from under a live browser.
#[tauri::command]
pub async fn disconnect_profile(profile: String) -> Result<serde_json::Value, String> {
    let name = profile.trim().to_string();
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
    {
        return Err("Invalid profile name.".to_string());
    }

    let dir = dirs::home_dir()
        .ok_or_else(|| "Could not locate home directory".to_string())?
        .join(".helmsman")
        .join("profiles")
        .join(&name);

    if let Some(binary) = resolve_path() {
        let name = name.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let mut cmd = build_command(&binary, "auth");
            cmd.arg("close").arg(&name);
            let _ = cmd.output();
        })
        .await;
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
