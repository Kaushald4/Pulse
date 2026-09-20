/**
 * Base resumes, tailored resumes and cover letters.
 *
 * A base resume is the single active document every prompt reads. Generated
 * resumes and cover letters are append-only history so you can compare drafts.
 */
import type { BaseResume, GeneratedResume, JobCoverLetter } from "../jobs/types";
import { getDatabase, readLocal, writeLocal } from "./client";
import {
  LS_JOB_COVER_LETTERS,
  LS_JOB_DRAFTS,
  LS_JOB_RESUMES,
  newJobId,
  rowToBaseResume,
  rowToCoverLetter,
  rowToGeneratedResume,
} from "./jobs-common";

/* ---------------------------------- base ---------------------------------- */

export async function getActiveResume(): Promise<BaseResume | null> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(
      `SELECT * FROM job_resumes WHERE is_active = 1 ORDER BY uploaded_at DESC LIMIT 1;`
    )) as any[];
    return rows[0] ? rowToBaseResume(rows[0]) : null;
  }
  const stored = readLocal<BaseResume[]>(LS_JOB_RESUMES, []);
  return stored.find((resume) => resume.isActive) ?? null;
}

/** Stores a new active resume and deactivates every previous one. */
export async function saveBaseResume(input: {
  fileName: string;
  mimeType: string;
  parsedText: string;
}): Promise<BaseResume> {
  const resume: BaseResume = {
    id: newJobId("resume"),
    fileName: input.fileName,
    mimeType: input.mimeType,
    parsedText: input.parsedText,
    isActive: true,
    uploadedAt: new Date().toISOString(),
  };
  const db = await getDatabase();

  if (db) {
    await db.execute(`UPDATE job_resumes SET is_active = 0 WHERE is_active = 1;`);
    await db.execute(
      `INSERT INTO job_resumes (id, file_name, mime_type, parsed_text, is_active, uploaded_at)
       VALUES ($1,$2,$3,$4,1,$5);`,
      [resume.id, resume.fileName, resume.mimeType, resume.parsedText, resume.uploadedAt]
    );
    return resume;
  }

  const stored = readLocal<BaseResume[]>(LS_JOB_RESUMES, []).map((entry) => ({
    ...entry,
    isActive: false,
  }));
  stored.unshift(resume);
  writeLocal(LS_JOB_RESUMES, stored);
  return resume;
}

/* -------------------------------- tailored -------------------------------- */

export async function getGeneratedResume(id: string): Promise<GeneratedResume | null> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM job_resume_drafts WHERE id = $1;`, [id])) as any[];
    return rows[0] ? rowToGeneratedResume(rows[0]) : null;
  }
  return readLocal<GeneratedResume[]>(LS_JOB_DRAFTS, []).find((draft) => draft.id === id) ?? null;
}

export async function getGeneratedResumes(jobId: string): Promise<GeneratedResume[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(
      `SELECT * FROM job_resume_drafts WHERE job_id = $1 ORDER BY generated_at DESC;`,
      [jobId]
    )) as any[];
    return rows.map(rowToGeneratedResume);
  }
  return readLocal<GeneratedResume[]>(LS_JOB_DRAFTS, [])
    .filter((draft) => draft.jobId === jobId)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function saveGeneratedResume(input: {
  jobId: string;
  baseResumeId: string | null;
  content: string;
  fileName: string;
}): Promise<GeneratedResume> {
  const draft: GeneratedResume = {
    id: newJobId("draft"),
    jobId: input.jobId,
    baseResumeId: input.baseResumeId,
    content: input.content,
    fileName: input.fileName,
    generatedAt: new Date().toISOString(),
  };
  const db = await getDatabase();

  if (db) {
    await db.execute(
      `INSERT INTO job_resume_drafts (id, job_id, base_resume_id, content, file_name, generated_at)
       VALUES ($1,$2,$3,$4,$5,$6);`,
      [draft.id, draft.jobId, draft.baseResumeId, draft.content, draft.fileName, draft.generatedAt]
    );
    return draft;
  }

  const stored = readLocal<GeneratedResume[]>(LS_JOB_DRAFTS, []);
  stored.unshift(draft);
  writeLocal(LS_JOB_DRAFTS, stored);
  return draft;
}

export async function updateGeneratedResumeContent(id: string, content: string): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`UPDATE job_resume_drafts SET content = $1 WHERE id = $2;`, [content, id]);
    return;
  }
  const stored = readLocal<GeneratedResume[]>(LS_JOB_DRAFTS, []);
  const draft = stored.find((entry) => entry.id === id);
  if (!draft) return;
  draft.content = content;
  writeLocal(LS_JOB_DRAFTS, stored);
}

export async function deleteGeneratedResume(id: string): Promise<void> {
  const db = await getDatabase();
  if (db) {
    await db.execute(`DELETE FROM job_resume_drafts WHERE id = $1;`, [id]);
    return;
  }
  writeLocal(
    LS_JOB_DRAFTS,
    readLocal<GeneratedResume[]>(LS_JOB_DRAFTS, []).filter((entry) => entry.id !== id)
  );
}

/* ------------------------------ cover letters ----------------------------- */

export async function getCoverLetter(id: string): Promise<JobCoverLetter | null> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(`SELECT * FROM job_cover_letters WHERE id = $1;`, [id])) as any[];
    return rows[0] ? rowToCoverLetter(rows[0]) : null;
  }
  return (
    readLocal<JobCoverLetter[]>(LS_JOB_COVER_LETTERS, []).find((letter) => letter.id === id) ?? null
  );
}

export async function getCoverLetters(jobId: string): Promise<JobCoverLetter[]> {
  const db = await getDatabase();
  if (db) {
    const rows = (await db.select(
      `SELECT * FROM job_cover_letters WHERE job_id = $1 ORDER BY generated_at DESC;`,
      [jobId]
    )) as any[];
    return rows.map(rowToCoverLetter);
  }
  return readLocal<JobCoverLetter[]>(LS_JOB_COVER_LETTERS, [])
    .filter((letter) => letter.jobId === jobId)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function saveCoverLetter(input: {
  jobId: string;
  content: string;
  tone?: string | null;
}): Promise<JobCoverLetter> {
  const letter: JobCoverLetter = {
    id: newJobId("letter"),
    jobId: input.jobId,
    content: input.content,
    tone: input.tone ?? null,
    generatedAt: new Date().toISOString(),
  };
  const db = await getDatabase();

  if (db) {
    await db.execute(
      `INSERT INTO job_cover_letters (id, job_id, content, tone, generated_at)
       VALUES ($1,$2,$3,$4,$5);`,
      [letter.id, letter.jobId, letter.content, letter.tone, letter.generatedAt]
    );
    return letter;
  }

  const stored = readLocal<JobCoverLetter[]>(LS_JOB_COVER_LETTERS, []);
  stored.unshift(letter);
  writeLocal(LS_JOB_COVER_LETTERS, stored);
  return letter;
}
