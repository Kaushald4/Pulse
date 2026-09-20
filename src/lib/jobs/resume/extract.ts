/**
 * Turning an uploaded resume into plain text.
 *
 * The two real formats need real parsers, and both ship browser builds, so the
 * renderer owns this and Rust stays at "read these bytes".
 */
import { isTauriEnv } from "../../config";

export interface ResumeFile {
  name: string;
  mimeType: string;
  base64: string;
}

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Opens the native picker. Returns null when the user cancels. */
export async function pickResumeFile(): Promise<ResumeFile | null> {
  if (!isTauriEnv()) throw new Error("Uploading a resume needs the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ResumeFile | null>("pick_resume_file");
}

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function extractPdf(base64: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // The worker is served from /public, which is where a static export puts it.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const document = await pdfjs.getDocument({ data: bytesOf(base64) }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((item) => ("str" in item ? item.str : "")).join(" ")
    );
  }

  return pages.join("\n\n").trim();
}

async function extractDocx(base64: string): Promise<string> {
  const mammoth = await import("mammoth");
  const bytes = bytesOf(base64);
  // A copy, so the buffer is a plain ArrayBuffer rather than a view into one.
  const result = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer });
  return result.value.trim();
}

/**
 * PDF text comes out in the file's internal draw order, which scrambles
 * multi-column resumes - `normalizeResume` is what puts it back in order.
 */
export async function extractResumeText(file: ResumeFile): Promise<string> {
  const text =
    file.mimeType === PDF_MIME
      ? await extractPdf(file.base64)
      : file.mimeType === DOCX_MIME
      ? await extractDocx(file.base64)
      : new TextDecoder().decode(bytesOf(file.base64));

  const trimmed = text.trim();
  if (!trimmed) throw new Error(`No text could be read from ${file.name}.`);
  return trimmed;
}
