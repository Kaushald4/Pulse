//! Unpacking the release bundle.
//!
//! Symlinks are handled here rather than by the `tar` crate. The bundle is built
//! on Linux, so npm shares node_modules/.bin entries as symlinks, and the crate
//! recreates them with symlink_file, which Windows refuses without Developer Mode
//! or elevation. Deferring them also lets a link extract after its target, which
//! matters because tar lists .bin before the packages it points at.

use flate2::read::GzDecoder;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Extracts a .tar.gz, refusing entries that would escape the destination.
///
/// Symlinks are unpacked here rather than by the `tar` crate. The bundle is built
/// on Linux, so npm's `node_modules/.bin` shims arrive as symlinks; the crate
/// recreates them with `symlink_file`, which Windows refuses without Developer Mode
/// or elevation, and it turns that refusal into a fatal "failed to unpack" - so the
/// whole install died on `.bin/yaml`. Deferring them also lets a link be unpacked
/// after its target, which matters because tar lists `.bin/` before the packages it
/// points at.
pub(super) fn extract_tar_gz(archive: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| format!("Could not open archive: {e}"))?;
    let mut tar = tar::Archive::new(GzDecoder::new(file));

    // `Entry::unpack_in` will not create the destination, and its containment
    // check rejects creating it as part of an entry's path, so extracting into a
    // directory that does not exist yet fails with a misleading "failed to create
    // <the entry's parent>". `Archive::unpack` creates it for exactly this reason.
    fs::create_dir_all(destination)
        .map_err(|e| format!("Could not create {}: {e}", destination.display()))?;

    let entries = tar
        .entries()
        .map_err(|e| format!("Could not read archive: {e}"))?;

    let mut links: Vec<(PathBuf, PathBuf)> = Vec::new();

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

        if matches!(entry.header().entry_type(), tar::EntryType::Symlink) {
            let target = entry
                .link_name()
                .map_err(|e| format!("Corrupt archive link: {e}"))?
                .ok_or_else(|| format!("Symlink without a target: {}", path.display()))?
                .into_owned();
            links.push((path, target));
            continue;
        }

        let unpacked = entry
            .unpack_in(destination)
            .map_err(|e| format!("Could not extract {}: {e}", path.display()))?;
        if !unpacked {
            return Err(format!("Refused to extract {}", path.display()));
        }
    }

    for (path, target) in links {
        unpack_symlink(destination, &path, &target)?;
    }

    Ok(())
}

/// Where a symlink's target lands, resolved without touching the filesystem and
/// required to stay inside `root`.
fn resolve_link(root: &Path, path: &Path, target: &Path) -> Option<PathBuf> {
    let base = path.parent().unwrap_or_else(|| Path::new(""));
    let mut normalized = PathBuf::new();

    for part in base.join(target).components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::Normal(part) => normalized.push(part),
            _ => return None,
        }
    }

    Some(root.join(normalized))
}

/// Recreates one symlink entry.
///
/// On Unix that is a real symlink. Windows only allows one with Developer Mode or
/// elevation, so the target's bytes are copied instead: the bundle's links point at
/// ordinary files inside it, and a copied shim behaves the same for our purposes. A
/// link whose target is absent is npm bookkeeping we never run, so it is skipped.
fn unpack_symlink(root: &Path, path: &Path, target: &Path) -> Result<(), String> {
    let link_path = root.join(path);
    let resolved = resolve_link(root, path, target)
        .ok_or_else(|| format!("Symlink escapes the destination: {}", path.display()))?;

    if let Some(parent) = link_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }

    #[cfg(unix)]
    if std::os::unix::fs::symlink(target, &link_path).is_ok() {
        return Ok(());
    }

    if resolved.is_file() {
        fs::copy(&resolved, &link_path)
            .map_err(|e| format!("Could not recreate {}: {e}", path.display()))?;
    }

    Ok(())
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

    /// The release bundle carries npm's `node_modules/.bin` entries as symlinks.
    /// Windows will not create one without privilege, and the `tar` crate turns that
    /// refusal into a fatal "failed to unpack", which aborted the whole install. The
    /// link must extract - as a link on Unix, a copy on Windows - and only after its
    /// target, because tar lists `.bin/` before the package it points at.
    #[test]
    fn symlink_entries_extract_after_their_targets() {
        let dir = scratch("pulse-helmsman-test-symlink");
        let archive = dir.join("bundle.tar.gz");

        let file = fs::File::create(&archive).expect("create archive");
        let gz = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut builder = tar::Builder::new(gz);

        // The link is appended first, exactly as npm packs it.
        let mut link = tar::Header::new_gnu();
        link.set_size(0);
        link.set_mode(0o777);
        link.set_entry_type(tar::EntryType::Symlink);
        link.set_link_name("../yaml/bin.mjs").expect("set link name");
        builder
            .append_data(&mut link, "helmsman/node_modules/.bin/yaml", std::io::empty())
            .expect("append symlink");

        let mut target = tar::Header::new_gnu();
        target.set_size(4);
        target.set_mode(0o644);
        target.set_entry_type(tar::EntryType::Regular);
        builder
            .append_data(&mut target, "helmsman/node_modules/yaml/bin.mjs", &b"yaml"[..])
            .expect("append target");

        builder
            .into_inner()
            .expect("finish tar")
            .finish()
            .expect("finish gzip");

        let out = dir.join("out");
        extract_tar_gz(&archive, &out).expect("extract");

        let linked = out
            .join("helmsman")
            .join("node_modules")
            .join(".bin")
            .join("yaml");
        assert!(linked.exists(), "the .bin entry should exist after extraction");
        assert_eq!(fs::read(&linked).expect("read link"), b"yaml");

        let _ = fs::remove_dir_all(&dir);
    }
}
