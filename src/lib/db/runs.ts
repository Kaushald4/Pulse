/**
 * The run log: one row per operation, so the Logs page can show what happened
 * and what it cost.
 */
import { getDatabase, readLocal, writeLocal } from "./client";
import { LS_RUNS } from "./local-keys";
import { rowToRun } from "./rows";

/**
 * A record of one operation - a source sync, a classification batch, a briefing,
 * or an article fetch. Long operations are inserted as `running` first so the
 * UI can show live progress, then finished with their outcome and token usage.
 */
export type RunCategory = "sync" | "classify" | "briefing" | "content" | "jobs";
export type RunStatus = "running" | "success" | "failed";

export interface RunRecord {
  id: string;
  category: RunCategory;
  label: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
  items: number;
  model: string | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
}

export async function startRun(entry: {
  category: RunCategory;
  label: string;
  model?: string | null;
  provider?: string | null;
}): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    await db.execute(
      `INSERT INTO runs (id, category, label, status, started_at, model, provider)
       VALUES ($1,$2,$3,'running',$4,$5,$6);`,
      [id, entry.category, entry.label, startedAt, entry.model ?? null, entry.provider ?? null]
    );
    return id;
  }

  const runs = readLocal<RunRecord[]>(LS_RUNS, []);
  runs.unshift({
    id,
    category: entry.category,
    label: entry.label,
    status: "running",
    startedAt,
    finishedAt: null,
    summary: null,
    error: null,
    items: 0,
    model: entry.model ?? null,
    provider: entry.provider ?? null,
    inputTokens: 0,
    outputTokens: 0,
  });
  writeLocal(LS_RUNS, runs.slice(0, 500));
  return id;
}

export async function finishRun(
  id: string,
  result: {
    status: RunStatus;
    summary?: string | null;
    error?: string | null;
    items?: number;
    model?: string | null;
    provider?: string | null;
    inputTokens?: number;
    outputTokens?: number;
  }
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const db = await getDatabase();

  if (db) {
    await db.execute(
      `UPDATE runs SET status = $1, finished_at = $2, summary = $3, error = $4, items = $5,
         model = COALESCE($6, model), provider = COALESCE($7, provider),
         input_tokens = $8, output_tokens = $9
       WHERE id = $10;`,
      [
        result.status,
        finishedAt,
        result.summary ?? null,
        result.error ?? null,
        result.items ?? 0,
        result.model ?? null,
        result.provider ?? null,
        result.inputTokens ?? 0,
        result.outputTokens ?? 0,
        id,
      ]
    );
    return;
  }

  const runs = readLocal<RunRecord[]>(LS_RUNS, []);
  const run = runs.find((entry) => entry.id === id);
  if (!run) return;
  run.status = result.status;
  run.finishedAt = finishedAt;
  run.summary = result.summary ?? null;
  run.error = result.error ?? null;
  run.items = result.items ?? 0;
  run.model = result.model ?? run.model;
  run.provider = result.provider ?? run.provider;
  run.inputTokens = result.inputTokens ?? 0;
  run.outputTokens = result.outputTokens ?? 0;
  writeLocal(LS_RUNS, runs);
}

/**
 * Writes recorded runs back exactly as they were.
 *
 * Only the browser-storage import uses this. `startRun` stamps the current time
 * and returns a fresh id, so it cannot replay history: the Logs view would show
 * the last sync of every past session as having happened now.
 */
export async function restoreRuns(runs: RunRecord[]): Promise<number> {
  if (runs.length === 0) return 0;
  const db = await getDatabase();
  if (!db) return 0;

  for (const run of runs) {
    await db.execute(
      `INSERT INTO runs (id, category, label, status, started_at, finished_at, summary, error,
         items, model, provider, input_tokens, output_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         finished_at = excluded.finished_at,
         summary = excluded.summary,
         error = excluded.error,
         items = excluded.items,
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens;`,
      [
        run.id,
        run.category,
        run.label,
        run.status,
        run.startedAt,
        run.finishedAt,
        run.summary,
        run.error,
        run.items,
        run.model,
        run.provider,
        run.inputTokens,
        run.outputTokens,
      ]
    );
  }
  return runs.length;
}

export async function getRuns(limit = 200): Promise<RunRecord[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM runs ORDER BY started_at DESC LIMIT $1;`, [limit])) as any[];
    return rows.map(rowToRun);
  }
  // The localStorage fallback keeps insertion order, so sort it explicitly to
  // match the SQLite path's newest-first ORDER BY.
  return readLocal<RunRecord[]>(LS_RUNS, [])
    .slice()
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Demo data + maintenance                                                     */
/* -------------------------------------------------------------------------- */
