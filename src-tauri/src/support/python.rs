//! Finding the Python interpreter Scrapling runs in.
//!
//! Python is not bundled, so this mirrors [`crate::support::node`]: look on the PATH, then
//! in the places an install usually lands, and always resolve to a real file that
//! answers `--version`.
//!
//! Windows has a trap the other platforms do not. When no interpreter is
//! installed, the Microsoft Store ships an "app execution alias" at
//! `%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe` that still answers to
//! `python`: it prints "Python was not found..." and exits non-zero. A bare
//! `python` therefore looks runnable, and the installer used to surface that Store
//! advert as if it were Scrapling's own error. Every candidate is validated
//! instead, and the python.org `py` launcher - which the alias does not shadow -
//! is tried first. Excluding the WindowsApps directory outright would be wrong,
//! because a Store-installed Python puts the real interpreter there too.

use std::fs;
use std::path::{Path, PathBuf};

use crate::config;
use crate::support::proc::{command, env_dir, executable_names, path_dirs};

/// Interpreter names to try, best first.
fn names() -> Vec<&'static str> {
    if cfg!(windows) {
        // `py` ships with the python.org installer and is not shadowed by the
        // Store alias, so it is the most reliable name on Windows.
        vec!["py", "python3", "python"]
    } else {
        vec!["python3", "python"]
    }
}

/// The `Python3xx` directories under `root`, newest first.
///
/// The installers lay them out as `.../Programs/Python/Python313`, so the version
/// is in the name; the parts are zero-padded, which keeps a plain sort correct.
fn version_dirs(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };

    let mut found: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with("Python"))
                    .unwrap_or(false)
        })
        .collect();

    found.sort();
    found.reverse();
    found
}

/// Where a Python install lands when it is not on the process PATH.
fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if cfg!(windows) {
        if let Some(local) = env_dir("LOCALAPPDATA") {
            let python = local.join("Programs").join("Python");
            dirs.push(python.join("Launcher")); // py.exe, for a per-user install
            dirs.extend(version_dirs(&python));
        }
        if let Some(program_files) = env_dir("ProgramFiles") {
            dirs.extend(version_dirs(&program_files));
        }
        if let Some(system_root) = env_dir("SystemRoot") {
            dirs.push(system_root); // py.exe lives beside System32
        }
    } else {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin"));
    }

    dirs
}

/// Every interpreter worth trying, in preference order.
///
/// Deliberately not `find_executable`: that returns the first matching *file* for a
/// name, and on Windows the Microsoft Store's `python.exe` stub sits earlier on the
/// PATH than any real install. So the first match is exactly the one to avoid, and
/// it hid the interpreter a fresh install had just placed on disk. Collecting every
/// candidate and letting [`version_of`] reject the duds means a working interpreter
/// further down the list still wins.
fn candidates() -> Vec<PathBuf> {
    let mut list = Vec::new();

    let configured = config::load().extraction.python_path.trim().to_string();
    if !configured.is_empty() {
        list.push(PathBuf::from(configured));
    }

    let mut dirs = path_dirs();
    dirs.extend(candidate_dirs());
    list.extend(candidate_paths(&names(), &dirs));

    list
}

/// Existing interpreter files for `names` across `dirs`, names outermost so the
/// `py` launcher anywhere is preferred to `python3` anywhere, and so on.
fn candidate_paths(names: &[&str], dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut list = Vec::new();

    for name in names {
        for dir in dirs {
            for file in executable_names(name) {
                let path = dir.join(&file);
                if path.is_file() {
                    list.push(path);
                }
            }
        }
    }

    list
}

/// The version from a real Python 3, or nothing when the program is missing, exits
/// non-zero, or is anything but Python 3 - which is how the Store's stub, a legacy
/// Python 2, and a missing install are all told apart from a usable interpreter.
fn version_of(program: &Path) -> Option<String> {
    let output = command(program).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }

    // 3.4+ writes the version to stdout; older builds wrote to stderr.
    let raw = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let text = raw.trim();
    if text.starts_with("Python 3") {
        Some(text.trim_start_matches("Python ").trim().to_string())
    } else {
        None
    }
}

/// The interpreter Scrapling should run in, or nothing when there is none.
pub fn resolve() -> Option<PathBuf> {
    candidates()
        .into_iter()
        .find(|program| version_of(program).is_some())
}

/// The version of the interpreter [`resolve`] picked.
pub fn version() -> Option<String> {
    version_of(&resolve()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpreter_names_lead_with_the_launcher_on_windows() {
        let names = names();
        assert!(names.contains(&"python3"));
        if cfg!(windows) {
            assert_eq!(names[0], "py", "the py launcher should be tried first");
        } else {
            assert_eq!(names[0], "python3");
        }
    }

    #[test]
    fn version_dirs_keep_only_python_installs_newest_first() {
        let root = std::env::temp_dir().join("pulse-python-version-dirs");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Python312")).expect("create 3.12 dir");
        fs::create_dir_all(root.join("Python313")).expect("create 3.13 dir");
        fs::create_dir_all(root.join("Launcher")).expect("create an unrelated dir");
        fs::write(root.join("Python313.exe"), b"").expect("create a stray file");

        let names: Vec<String> = version_dirs(&root)
            .iter()
            .map(|path| path.file_name().unwrap_or_default().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["Python313", "Python312"]);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_resolved_interpreter_is_a_real_python_3() {
        // The bug this guards: reporting an interpreter that is not one, which is
        // exactly what the Microsoft Store alias would look like.
        let Some(python) = resolve() else {
            return; // no Python on this machine; nothing to assert
        };
        assert!(
            python.is_file(),
            "resolved {} which does not exist",
            python.display()
        );
        let version = version().expect("resolved an interpreter that reports no version");
        assert!(version.starts_with('3'), "unexpected version {version}");
    }

    #[test]
    fn a_program_that_is_not_python_is_rejected() {
        assert!(version_of(Path::new("pulse-definitely-not-python")).is_none());
    }

    /// Guards the bug that broke the Windows install: resolution used
    /// `find_executable`, which returned only the first matching file, so the Store's
    /// `python.exe` stub earlier on the PATH hid the interpreter that had just been
    /// installed and setup reported "no interpreter could be found".
    #[test]
    fn a_name_in_an_earlier_directory_does_not_hide_a_later_one() {
        let root = std::env::temp_dir().join("pulse-python-shadowing");
        let _ = fs::remove_dir_all(&root);
        let first = root.join("first");
        let second = root.join("second");
        fs::create_dir_all(&first).expect("create first dir");
        fs::create_dir_all(&second).expect("create second dir");
        let stub = first.join(&executable_names("python")[0]);
        let real = second.join(&executable_names("python")[0]);
        fs::write(&stub, b"stub").expect("write stub");
        fs::write(&real, b"real").expect("write real");

        assert_eq!(candidate_paths(&["python"], &[first, second]), vec![stub, real]);

        let _ = fs::remove_dir_all(&root);
    }
}
