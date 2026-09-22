/**
 * Runs one scan across every configured entry.
 *
 * Each entry is a *different* external host, so the risk isn't hammering one -
 * it's many simultaneous outbound connections looking like a burst.
 * CONCURRENCY bounds how many run at once, JITTER_MS staggers their starts, and
 * MAX_PAGES caps any provider that paginates internally.
 *
 * Three further limits keep a scan bounded in time. Per-request timeouts alone
 * were not enough: a provider that paginates, backs off and retries can spend
 * minutes inside one entry, and one that never settles holds the whole scan open,
 * because nothing above it is watching the clock. ENTRY_TIMEOUT_MS caps a single
 * board, SCAN_BUDGET_MS caps the run, and both are reported as ordinary per-entry
 * errors so the rest of the scan carries on.
 */
import { resolveProvider } from "../providers/_registry.mjs";
import { makeHttpContext } from "./http.mjs";
import { isStale, normalizeJob } from "./normalize.mjs";

const CONCURRENCY = 4;
const JITTER_MS = 400;
const MAX_PAGES = 3;

/** A single board, including every page and retry it makes. */
const ENTRY_TIMEOUT_MS = 45_000;

/** The scan as a whole, plus at most one entry deadline on top. */
const SCAN_BUDGET_MS = 180_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sentinel for the race in `processEntry`; never a real result. */
const TIMED_OUT = Symbol("timed-out");

async function processEntry(entry, providers, baseCtx, entryTimeoutMs) {
  const base = { entry: entry.name, provider: null, jobs: [], seen: [], error: null };
  const resolved = resolveProvider(entry, providers);

  if (!resolved) {
    return {
      ...base,
      error: `no provider matched "${entry.name}" - set a provider id or a recognizable careers_url`,
    };
  }
  if ("error" in resolved) return { ...base, error: resolved.error };

  const provider = resolved.provider;
  const timeoutMessage = `no response within ${Math.round(entryTimeoutMs / 1000)}s`;
  // One controller per entry, shared by every request it makes, so the deadline
  // can cut all of them off at once.
  const controller = new AbortController();

  let expire;
  const deadline = new Promise((resolve) => {
    expire = setTimeout(() => {
      controller.abort();
      resolve(TIMED_OUT);
    }, entryTimeoutMs);
  });

  const work = (async () => {
    const jobs = await provider.fetch(entry, {
      ...baseCtx,
      ...makeHttpContext(controller.signal),
    });
    const seen = [];
    const drafts = [];

    for (const job of jobs) {
      // The provider contract requires both; skip malformed rows rather than
      // failing the whole entry.
      if (!job.title?.trim() || !job.url?.trim()) continue;

      // Collected before the age filter: staleness-by-age and
      // closed-by-disappearance are independent signals, so an old listing
      // that is still live must still count as "seen".
      seen.push(job.url);
      if (isStale(job.postedAt)) continue;
      drafts.push(normalizeJob(job, provider.id, entry.name));
    }

    return { ...base, provider: provider.id, jobs: drafts, seen };
  })().catch((err) => ({
    ...base,
    provider: provider.id,
    // An entry cut off mid-flight reports its own abort error, which says
    // nothing useful, so the deadline's message is used instead.
    error: controller.signal.aborted ? timeoutMessage() : (err?.message ?? String(err)),
  }));

  // Raced as well as aborted. The abort closes the sockets, which is what lets
  // this process exit; the race covers a provider that ignores the signal.
  const result = await Promise.race([work, deadline]);
  clearTimeout(expire);

  return result === TIMED_OUT ? { ...base, provider: provider.id, error: timeoutMessage } : result;
}

export async function runEntries(
  entries,
  providers,
  {
    maxPages = MAX_PAGES,
    onEntry,
    onEntryStart,
    entryTimeoutMs = ENTRY_TIMEOUT_MS,
    scanBudgetMs = SCAN_BUDGET_MS,
  } = {}
) {
  const ctx = { ...makeHttpContext(), maxPages, sleep };
  const results = [];
  const startedAt = Date.now();

  // Bounded-concurrency pool with a small startup jitter per task: polite (no
  // thundering herd) without being slow (still CONCURRENCY entries in flight).
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= entries.length) return;

      // Past the budget the remaining entries are reported rather than run: a
      // scan that admits it gave up is worth more than one that never returns.
      if (Date.now() - startedAt > scanBudgetMs) {
        const skipped = {
          entry: entries[index].name,
          provider: null,
          jobs: [],
          seen: [],
          error: `skipped: the scan passed its ${Math.round(scanBudgetMs / 1000)}s budget`,
        };
        results[index] = skipped;
        onEntry?.(skipped);
        continue;
      }

      await sleep(Math.random() * JITTER_MS);
      // Announced before the work starts, so the UI can name the board it is
      // waiting on instead of the last one it finished.
      onEntryStart?.(entries[index]);
      const result = await processEntry(entries[index], providers, ctx, entryTimeoutMs);
      results[index] = result;
      // Reported the moment it lands, so the UI can show real progress.
      onEntry?.(result);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker()));
  return results;
}
