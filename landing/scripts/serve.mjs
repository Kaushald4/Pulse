#!/usr/bin/env node
/**
 * Serves `dist/` for a local preview.
 *
 * A tiny static server so previewing needs no extra dependency and behaves the
 * same on every platform. Run `pnpm build` first.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".mjs": "text/javascript; charset=utf-8",
};

if (!existsSync(root)) {
  console.error("dist/ is missing. Run `pnpm build` first.");
  process.exit(1);
}

createServer((request, response) => {
  const requested = decodeURIComponent((request.url ?? "/").split("?")[0]);
  // Keep the served path inside dist/.
  const relative = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, relative);

  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) file = join(root, "index.html");

  response.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  response.end(readFileSync(file));
}).listen(port, () => {
  console.log(`Landing preview on http://localhost:${port}`);
});
