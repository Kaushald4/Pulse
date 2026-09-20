/**
 * The upload flow: pick a file, read it, clean it up, make it the active base
 * resume.
 */
import { saveBaseResume } from "../../db/job-resumes";
import type { BaseResume } from "../types";
import { extractResumeText, pickResumeFile } from "./extract";
import { normalizeResume } from "./normalize";

export interface UploadResumeResult {
  cancelled?: boolean;
  resume?: BaseResume;
  warning?: string;
}

export async function uploadBaseResume(): Promise<UploadResumeResult> {
  const file = await pickResumeFile();
  if (!file) return { cancelled: true };

  const raw = await extractResumeText(file);
  const cleaned = await normalizeResume(raw);
  const resume = await saveBaseResume({
    fileName: file.name,
    mimeType: file.mimeType,
    parsedText: cleaned.text,
  });

  return { resume, warning: cleaned.warning };
}
