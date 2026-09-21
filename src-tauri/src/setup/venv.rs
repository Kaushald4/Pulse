//! The private Python environment Scrapling runs in.
//!
//! A venv rather than the system interpreter: Homebrew and Debian both refuse
//! pip installs outside one, and writing into the user's global site-packages to
//! work around that would be rude.

use crate::config;
use crate::support::python;
use std::path::{Path, PathBuf};

use super::flow::run_checked;

/// The extras Scrapling needs for the reader path we use.
const SCRAPLING_PACKAGE: &str = "scrapling[rag]";

/* -------------------------------------------------------------------------- */
/* Detecting what is already there                                             */
/* -------------------------------------------------------------------------- */

/// The private environment the installer creates when the system Python will not
/// take packages (Homebrew and Debian both refuse by default).
pub(super) fn venv_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".pulse").join("venv"))
        .ok_or_else(|| "Could not locate home directory".to_string())
}

/// Where a venv keeps its interpreter.
pub(super) fn venv_python(dir: &Path) -> PathBuf {
    if cfg!(windows) {
        dir.join("Scripts").join("python.exe")
    } else {
        dir.join("bin").join("python3")
    }
}

/// Installs Scrapling.
///
/// A private venv rather than the system interpreter: Homebrew's Python and
/// Debian's both refuse `pip install` outside a venv (PEP 668), and writing into
/// the user's global site-packages to work around that would be rude. The app's
/// `extraction.pythonPath` then points at the venv, so the reader finds it.
pub(super) fn install_scrapling(on_line: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
