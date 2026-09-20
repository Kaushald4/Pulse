/**
 * Storage primitives shared by every db module.
 *
 * SQLite when the app runs under Tauri, localStorage otherwise, so the browser
 * preview behaves the same way the desktop build does.
 */
import { ensureSchema } from "./schema";

let tauriDb: any = null;
let tauriChecked = false;

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

  if (!isTauri()) return null;

  try {
    const mod = await import("@tauri-apps/plugin-sql");
    const Database = (mod as any).default ?? mod;
    const db = await Database.load("sqlite:pulse.db");
    await ensureSchema(db);
    tauriDb = db;
  } catch (err) {
    console.warn("[Pulse] SQLite unavailable, using browser storage:", err);
    tauriDb = null;
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
