//! Running an external command and watching it work.
//!
//! The job scanner, the installer and anything else that shells out to a long
//! command needs the same three things: drain both pipes without deadlocking,
//! hand each line to the caller as it arrives, and keep the tail of stderr for
//! when the command fails. That all lives here.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};

/// Lines a script prefixes with this are progress, not logging.
pub const PROGRESS_PREFIX: &str = "@@progress ";

const STDERR_TAIL_LINES: usize = 40;

pub struct ProcRun {
    pub success: bool,
    pub stdout: String,
    /// Last few stderr lines, kept for the failure message.
    pub stderr_tail: String,
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
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", program.display()))?;

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
