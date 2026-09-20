#!/usr/bin/env node
/**
 * Cross-platform entry point for the `tauri` script.
 *
 * This used to be `sh scripts/tauri.sh`, which cannot run on Windows: there is
 * no `sh` there, so `pnpm tauri dev` died with "sh is not recognized as an
 * internal or external command" before the Tauri CLI ever started. Node is
 * already a hard requirement for the frontend, so the dispatch lives here.
 *
 * macOS releases still go through build-macos.sh, which codesigns the app and
 * assembles the DMG. That one is deliberately shell, and deliberately
 * macOS-only - codesign and hdiutil have no equivalent elsewhere.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const isMacosBuild = process.platform === "darwin" && args[0] === "build";

const [command, commandArgs] = isMacosBuild
  ? ["sh", [join(here, "build-macos.sh"), ...args]]
  : ["pnpm", ["exec", "tauri", ...args]];

// Windows reaches pnpm through pnpm.cmd, which only a shell can execute.
const { status, error } = spawnSync(command, commandArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (error) {
  console.error(`Could not run ${command}: ${error.message}`);
  process.exit(1);
}

process.exit(status ?? 1);
