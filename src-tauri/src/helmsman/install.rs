//! Downloading and installing the release bundle.

use std::fs;
use std::path::Path;

use crate::support::node::node_available;

use super::archive::extract_tar_gz;
use super::resolve::{managed_entry, version_for};

const HELMSMAN_REPO: &str = "Kaushald4/helmsman-cli";
const ASSET_PREFIX: &str = "helmsman-cli-";
const ASSET_SUFFIX: &str = ".tar.gz";
/// Guard against a runaway download; the real bundle is a few megabytes.
const MAX_ARCHIVE_BYTES: u64 = 200 * 1024 * 1024;

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
