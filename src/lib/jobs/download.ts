/**
 * Saving a generated document to disk.
 *
 * The .docx is rendered at download time rather than stored, so edits to the
 * text are always reflected in what you get.
 */
import { isTauriEnv } from "../config";

export async function saveResumeAsDocx(fileName: string, content: string): Promise<string | null> {
  if (!isTauriEnv()) throw new Error("Saving a document needs the desktop app.");

  // Imported here so the docx library stays out of the app's initial bundle.
  const { renderTextToDocx } = await import("./docx/render");
  const base64Data = await renderTextToDocx(content);

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("save_job_file", { fileName, base64Data });
}
