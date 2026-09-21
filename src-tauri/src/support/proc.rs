//! Running an external command and watching it work.
//!
//! The job scanner, the installer and anything else that shells out to a long
//! command needs the same three things: drain both pipes without deadlocking,
//! hand each line to the caller as it arrives, and keep the tail of stderr for
//! when the command fails. That all lives here.

use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Lines a script prefixes with this are progress, not logging.
pub const PROGRESS_PREFIX: &str = "@@progress ";

const STDERR_TAIL_LINES: usize = 40;

/* -------------------------------------------------------------------------- */
/* Finding an executable                                                       */
/* -------------------------------------------------------------------------- */

/// Every file name one command can have on this platform.
///
/// Windows appends an extension, so a bare `node` never matches there: the file
/// is `node.exe`. Looking for the bare name made Node read as missing on
/// Windows, and because Node is a required component, first-run setup could
/// never complete - it stayed "blocked" and the wizard returned every launch.
pub fn executable_names(stem: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![
            format!("{stem}.exe"),
            format!("{stem}.cmd"),
            format!("{stem}.bat"),
        ]
    } else {
        vec![stem.to_string()]
    }
}

/// The first existing file named after `stem` across the given directories.
pub fn find_executable(dirs: &[PathBuf], stem: &str) -> Option<PathBuf> {
    let names = executable_names(stem);
    dirs.iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|candidate| candidate.is_file())
}

/// `PATH`, split into directories.
pub fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default()
}

/// An environment variable as a directory, when set.
pub fn env_dir(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub struct ProcRun {
    pub success: bool,
    pub stdout: String,
    /// Last few stderr lines, kept for the failure message.
    pub stderr_tail: String,
}

/// A `Command` that will not flash a console window on Windows.
///
/// A GUI process has no console of its own, so Windows hands each console program
/// it spawns - node, python, the installer - a brand-new console window. That is
/// what made syncing flicker terminals. `CREATE_NO_WINDOW` starts the child without
/// one; the stdio pipes set up below still work exactly the same.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    // `mut` is needed only on Windows, where the creation flag is set below.
    // Gated rather than removed, or the Windows build loses it.
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = Command::new(program);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // https://learn.microsoft.com/windows/win32/procthread/process-creation-flags
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd
}

/// Runs `program` to completion, handing every stderr line to `on_line` as it
/// arrives. `stdin` is written and then closed, which is how a script that reads
/// until EOF learns it can stop.
///
/// stderr is drained on its own thread: a command that talks while it works
/// would otherwise fill the pipe buffer and block forever. The thread is scoped,
/// so `on_line` may borrow - it is only alive for the duration of this call.
pub fn run_streaming(
    program: &Path,
    args: &[String],
    stdin: Option<&str>,
    on_line: &(dyn Fn(&str) + Send + Sync),
) -> Result<ProcRun, String> {
    run_streaming_notify(program, args, stdin, on_line, &|_| {})
}

/// Same as [`run_streaming`], and reports the child's pid the moment it exists.
///
/// The pid rather than the `Child` itself, because the child is owned here while
/// its output is streamed, and something else has to be able to stop it from
/// another thread. A callback keeps that possible without handing out the handle.
pub fn run_streaming_notify(
    program: &Path,
    args: &[String],
    stdin: Option<&str>,
    on_line: &(dyn Fn(&str) + Send + Sync),
    on_spawn: &(dyn Fn(u32) + Send + Sync),
) -> Result<ProcRun, String> {
    let mut child = command(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", program.display()))?;

    on_spawn(child.id());

    if let (Some(mut pipe), Some(input)) = (child.stdin.take(), stdin) {
        pipe.write_all(input.as_bytes())
            .map_err(|error| format!("Could not send input to {}: {error}", program.display()))?;
    }

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("{} produced no error stream", program.display()))?;

    std::thread::scope(|scope| {
        let reader = scope.spawn(move || {
            let mut tail: Vec<String> = Vec::new();
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                on_line(&line);
                if tail.len() == STDERR_TAIL_LINES {
                    tail.remove(0);
                }
                tail.push(line);
            }
            tail
        });

        let mut stdout = String::new();
        if let Some(mut stream) = child.stdout.take() {
            stream
                .read_to_string(&mut stdout)
                .map_err(|error| format!("Could not read output of {}: {error}", program.display()))?;
        }

        let status = child
            .wait()
            .map_err(|error| format!("{} did not finish: {error}", program.display()))?;
        let tail = reader.join().unwrap_or_default();

        Ok(ProcRun {
            success: status.success(),
            stdout,
            stderr_tail: tail.join("\n"),
        })
    })
}

/// Stops a process this app started, by pid.
///
/// Used to abandon work the user asked for and no longer wants, so it goes
/// through the platform's own tool rather than a signal crate: `kill` on Unix,
/// and `taskkill /T` on Windows so anything the child started goes with it.
/// A process that is already gone is not an error, since the caller's intent -
/// that it stops - is satisfied either way.
pub fn stop_process(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    let outcome = command(Path::new("taskkill")).args(["/F", "/T", "/PID", &pid.to_string()]).status();
    #[cfg(not(windows))]
    let outcome = command(Path::new("kill")).args(["-9", &pid.to_string()]).status();

    match outcome {
        Ok(_) => Ok(()),
        Err(error) => Err(format!("Could not stop process {pid}: {error}")),
    }
}

/// Parses a command's stdout, tolerating stray leading/trailing non-JSON lines.
pub fn parse_json_lenient(raw: &str, source: &str) -> Result<serde_json::Value, String> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw.trim()) {
        return Ok(value);
    }

    let start = raw
        .find(['{', '['])
        .ok_or_else(|| format!("{source} returned no JSON output"))?;
    let end = raw
        .rfind(['}', ']'])
        .ok_or_else(|| format!("{source} returned malformed JSON"))?;
    if end < start {
        return Err(format!("{source} returned malformed JSON"));
    }

    serde_json::from_str(&raw[start..=end])
        .map_err(|error| format!("{source} returned invalid JSON: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Windows needs the extension: looking for a bare `node` there made Node
    /// read as missing and blocked first-run setup.
    #[test]
    fn executable_names_follow_the_platform_suffix_rule() {
        let names = executable_names("node");
        assert!(!names.is_empty());
        if cfg!(windows) {
            assert!(names.contains(&"node.exe".to_string()));
        } else {
            assert_eq!(names, vec!["node".to_string()]);
        }
    }

    #[test]
    fn finds_a_real_file_and_ignores_a_missing_one() {
        let dir = std::env::temp_dir().join("pulse-proc-find-executable");
        std::fs::create_dir_all(&dir).expect("could not create the probe directory");
        let probe = dir.join(&executable_names("probe")[0]);
        std::fs::write(&probe, b"").expect("could not write the probe file");

        assert_eq!(find_executable(&[dir.clone()], "probe"), Some(probe));
        assert_eq!(find_executable(&[dir], "definitely-not-installed"), None);
    }
}
