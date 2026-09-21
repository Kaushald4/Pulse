#!/usr/bin/env node
/**
 * Job board scanner.
 *
 * Reads `{ entries, maxPages }` as JSON on stdin and writes one result per
 * entry as JSON on stdout:
 *
 *   [{ entry, provider, jobs: JobDraft[], seen: string[], error }]
 *
 * `jobs` are ready to store; `seen` is every valid URL the entry returned,
 * which the caller needs to close listings that disappeared. Pulse runs this
 * with the system Node (the same prerequisite helmsman already needs) because
 * the providers use `readdirSync` and cross-origin `fetch`, neither of which
 * works inside the webview.
 *
 * Run it by hand to smoke-test the providers:
 *   echo '{"entries":[{"name":"RemoteOK","provider":"remoteok"}]}' | node jobs/scan.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProviders } from "./providers/_registry.mjs";
import { runEntries } from "./scan/run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = join(HERE, "providers");

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = (await readStdin()).trim();
  const input = raw ? JSON.parse(raw) : {};
  const entries = Array.isArray(input.entries) ? input.entries : [];
  if (entries.length === 0) {
    process.stdout.write("[]");
    return;
  }

  const providers = await loadProviders(PROVIDERS_DIR);
  const results = await runEntries(entries, providers, {
    maxPages: input.maxPages ?? undefined,
    // Progress goes to stderr (stdout stays the result). A start line names the
    // board being waited on; a finish line carries what it returned.
    onEntryStart: (entry) => {
      process.stderr.write(`@@progress ${JSON.stringify({ entry: entry.name, started: true })}\n`);
    },
    onEntry: (result) => {
      process.stderr.write(
        `@@progress ${JSON.stringify({
          entry: result.entry,
          provider: result.provider,
          jobs: result.jobs.length,
          error: result.error,
        })}\n`
      );
    },
  });
  process.stdout.write(JSON.stringify(results));
}

main().catch((err) => {
  process.stderr.write(`job scan failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
