#!/usr/bin/env node
/**
 * Builds the landing page into `dist/`.
 *
 * Deliberately a Node script rather than a shell pipeline: `cp` and friends do
 * not exist on Windows, and this project is meant to build anywhere. Node is
 * already required for Tailwind's CLI.
 *
 * Steps: compile Tailwind, copy the page and its assets, drop a `.nojekyll` so
 * GitHub Pages serves the files as-is.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const tailwind = join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tailwindcss.cmd" : "tailwindcss"
);

if (!existsSync(tailwind)) {
  console.error("Tailwind CLI is missing. Run `pnpm install` inside landing/ first.");
  process.exit(1);
}

const args = ["-i", join(root, "src", "styles.css"), "-o", join(dist, "styles.css")];
args.push(watch ? "--watch" : "--minify");

const result = spawnSync(tailwind, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(`Could not run Tailwind: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

cpSync(join(root, "index.html"), join(dist, "index.html"));
cpSync(join(root, "assets"), join(dist, "assets"), { recursive: true });

// Stops GitHub Pages from running the output through Jekyll.
writeFileSync(join(dist, ".nojekyll"), "");

console.log(watch ? "Watching for changes…" : `Built ${dist}`);
