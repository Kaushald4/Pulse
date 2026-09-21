#!/usr/bin/env node
/**
 * Builds the updater manifest (`latest.json`) from signed release artifacts.
 *
 * Tauri's updater fetches one JSON document that lists, per platform, the
 * archive to download and the signature to verify it against. That document is
 * the only thing the published app is asked to trust, so this fails loudly when
 * a platform is missing rather than emitting a manifest that would leave those
 * users silently stuck on an old build.
 *
 * Usage:
 *   node scripts/updater-manifest.mjs <artifacts-dir> <tag> <repo> <version> [out]
 *
 * `artifacts-dir` is the directory the release workflow downloads the build
 * artifacts into; it is searched recursively.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Tauri's platform keys, matched by the artifact filename it produces. */
const PLATFORMS = [
  {
    key: "darwin-aarch64",
    // Tauri emits the whole .app as an updater archive for macOS.
    matches: (name) => name.endsWith(".app.tar.gz"),
  },
  {
    key: "windows-x86_64",
    // NSIS is the Windows updater target; the .zip wraps the installer.
    matches: (name) => name.endsWith(".nsis.zip"),
  },
];

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

function main() {
  const [dir, tag, repo, version, out = "latest.json"] = process.argv.slice(2);

  if (!dir || !tag || !repo || !version) {
    console.error(
      "usage: updater-manifest.mjs <artifacts-dir> <tag> <owner/repo> <version> [out]"
    );
    process.exit(2);
  }

  const files = walk(dir);
  const signatures = new Map(
    files.filter((f) => f.endsWith(".sig")).map((f) => [f.slice(0, -4), f])
  );

  const platforms = {};
  const missing = [];

  for (const { key, matches } of PLATFORMS) {
    const archive = files.find((f) => matches(f.split("/").pop() ?? ""));
    const signaturePath = archive ? signatures.get(archive) : undefined;

    if (!archive || !signaturePath) {
      missing.push(key);
      continue;
    }

    const name = archive.split("/").pop();
    platforms[key] = {
      // Tauri expects the signature inline, not a URL to it.
      signature: readFileSync(signaturePath, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
    };
    console.log(`  ${key.padEnd(16)} ${name}`);
  }

  if (missing.length > 0) {
    console.error(`\nNo signed updater artifact found for: ${missing.join(", ")}`);
    console.error("Did the build run with createUpdaterArtifacts and the signing key set?");
    process.exit(1);
  }

  const manifest = {
    version,
    // `notes` left unset on purpose: the update dialog already names the
    // version, and GitHub generates the release notes separately.
    pub_date: new Date().toISOString(),
    platforms,
  };

  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nWrote ${relative(process.cwd(), out)} for ${version}`);
}

main();
