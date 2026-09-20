/**
 * Source rows: the saved connection state, and the per-source sync outcome.
 */
import type { SourceConnection } from "../types";
import { DEFAULT_SOURCES } from "../sources/sample-data";
import { getDatabase, readLocal, writeLocal } from "./client";
import { LS_SOURCES } from "./local-keys";
import { rowToSource } from "./rows";

/** Errors that mean the saved browser session is no longer usable. */
const AUTH_ERROR_RE = /login wall|requires authentication|re-authenticate|not logged in|sign in/i;

/**
 * Saved rows win, but any option they never set is filled from the current
 * default - so improved defaults reach existing installs while real user
 * choices are never overwritten.
 */
function mergeSourceDefaults(
  source: SourceConnection,
  saved: SourceConnection
): SourceConnection {
  return {
    ...saved,
    options: { ...source.options, ...saved.options },
    monitoredChannels:
      (saved.monitoredChannels?.length ?? 0) > 0 ? saved.monitoredChannels : source.monitoredChannels,
  };
}

export async function getSources(): Promise<SourceConnection[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM sources;`)) as any[];
    if (rows.length === 0) {
      await persistSources(db, DEFAULT_SOURCES);
      return DEFAULT_SOURCES.map((source) => ({ ...source }));
    }
    const byId = new Map(rows.map((row) => [row.id, rowToSource(row)]));
    return DEFAULT_SOURCES.map((source) => {
      const saved = byId.get(source.id);
      return saved ? mergeSourceDefaults(source, saved) : source;
    });
  }

  const stored = readLocal<SourceConnection[]>(LS_SOURCES, []);
  if (stored.length === 0) return DEFAULT_SOURCES.map((source) => ({ ...source }));
  const byId = new Map(stored.map((source) => [source.id, source]));
  return DEFAULT_SOURCES.map((source) => {
    const saved = byId.get(source.id);
    return saved ? mergeSourceDefaults(source, saved) : source;
  });
}

async function persistSources(db: any, sources: SourceConnection[]): Promise<void> {
  for (const source of sources) {
    await db.execute(
      `INSERT INTO sources (id, name, source, auth_type, profile_name, site_domain, is_connected, channels_json, options_json, enabled, last_sync_at, last_error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(id) DO UPDATE SET
         is_connected = excluded.is_connected,
         channels_json = excluded.channels_json,
         options_json = excluded.options_json,
         enabled = excluded.enabled,
         last_sync_at = COALESCE(excluded.last_sync_at, sources.last_sync_at),
         last_error = excluded.last_error;`,
      [
        source.id,
        source.name,
        source.source,
        source.authType,
        source.profileName ?? null,
        source.siteDomain ?? null,
        source.isConnected ? 1 : 0,
        JSON.stringify(source.monitoredChannels ?? []),
        JSON.stringify(source.options ?? {}),
        source.enabled === false ? 0 : 1,
        source.lastSyncAt ?? null,
        source.lastError ?? null,
      ]
    );
  }
}

export async function saveSources(sources: SourceConnection[]): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await persistSources(db, sources);
    return;
  }
  writeLocal(LS_SOURCES, sources);
}

export async function recordSyncResult(
  source: string,
  result: { ok: boolean; lastSyncAt?: string; error?: string }
): Promise<void> {
  const sources = await getSources();
  const authFailure = !result.ok && AUTH_ERROR_RE.test(result.error ?? "");

  const next = sources.map((entry) =>
    entry.source === source || entry.id === source
      ? {
          ...entry,
          lastSyncAt: result.ok ? result.lastSyncAt ?? new Date().toISOString() : entry.lastSyncAt,
          // A successful sync is the only real proof the saved profile works.
          // A directory existing proves nothing, so we never infer from that.
          isConnected: result.ok ? true : authFailure ? false : entry.isConnected,
          lastError: result.ok ? undefined : result.error,
        }
      : entry
  );
  await saveSources(next);
}

/* -------------------------------------------------------------------------- */
/* Run log                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A record of one operation - a source sync, a classification batch, a briefing,
 * or an article fetch. Long operations are inserted as `running` first so the
 * UI can show live progress, then finished with their outcome and token usage.
 */
