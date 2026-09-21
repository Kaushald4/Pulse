/**
 * Storage primitives shared by every db module.
 *
 * SQLite when the app runs under Tauri, localStorage otherwise, so the browser
 * preview behaves the same way the desktop build does.
 */
import { ensureSchema } from "./schema";
import { importBrowserStorage } from "./migrate";

let tauriDb: any = null;
let tauriChecked = false;

/** Which store the app actually opened: "unknown" until the first attempt. */
export type StorageMode = "unknown" | "sqlite" | "browser";

let storageMode: StorageMode = "unknown";
let storageError: string | null = null;

/**
 * Where the data really lives.
 *
 * The app falls back to browser storage when it cannot open SQLite, which is
 * silent and was how it ended up running on localStorage for weeks without anyone
 * noticing. Reporting the mode lets the UI say so out loud.
 */
export function getStorageStatus(): { mode: StorageMode; error: string | null } {
  return { mode: storageMode, error: storageError };
}

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window;
}

/* -------------------------------------------------------------------------- */
/* Browser fallback storage                                                    */
/* -------------------------------------------------------------------------- */

export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error("[Pulse] localStorage write failed:", err);
  }
}

export async function getDatabase(): Promise<any> {
  if (tauriChecked) return tauriDb;
  tauriChecked = true;

  if (!isTauri()) {
    // The browser preview has no SQLite to open; this is the intended store there.
    storageMode = "browser";
    return null;
  }

  try {
    const mod = await import("@tauri-apps/plugin-sql");
    const Database = (mod as any).default ?? mod;
    const db = await Database.load("sqlite:pulse.db");
    await ensureSchema(db);
    // Assigned before the import below, deliberately. Every writer calls back into
    // getDatabase(), and with tauriChecked already set they would otherwise read a
    // null connection and quietly write to localStorage instead of SQLite.
    tauriDb = db;
    storageMode = "sqlite";
    storageError = null;
    await importBrowserStorage(db);
  } catch (err) {
    console.warn("[Pulse] SQLite unavailable, using browser storage:", err);
    tauriDb = null;
    storageMode = "browser";
    storageError = err instanceof Error ? err.message : String(err);
  }
  return tauriDb;
}

export function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
