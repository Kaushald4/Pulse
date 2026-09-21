//! What the installer knows how to check for.
//!
//! Every dependency Pulse leans on is one row in COMPONENTS, so adding the next
//! one is a new entry here plus an arm in the install match, rather than another
//! special case in the UI.

use crate::helmsman;
use crate::support::node::{node_available, node_version};
use crate::support::proc::command;
use crate::support::python;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy)]
pub(super) struct Component {
    pub(super) id: &'static str,
    pub(super) title: &'static str,
    pub(super) detail: &'static str,
    /// A missing required component blocks the app; a missing optional one does not.
    pub(super) required: bool,
    /// Shown when Pulse cannot install this itself.
    pub(super) manual: Option<&'static str>,
}

pub(super) const COMPONENTS: &[Component] = &[
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
pub(super) fn has_run() -> bool {
    marker_path().map(|path| path.is_file()).unwrap_or(false)
}

pub(super) fn write_marker(value: Value) -> Result<(), String> {
    let path = marker_path().ok_or_else(|| "Could not locate home directory".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    fs::write(&path, raw).map_err(|error| format!("Could not write {}: {error}", path.display()))
}

pub(super) fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn command_output(program: &Path, args: &[&str]) -> Option<String> {
    let output = command(program).args(args).output().ok()?;
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
pub(super) fn inspect(id: &str) -> (bool, Option<String>) {
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
}
