/**
 * Reorders raw extracted resume text with the model.
 *
 * A faithful re-organisation, never a rewrite: PDF extraction reads a file's
 * internal draw order, so a multi-column resume arrives with each role's
 * bullets detached from its heading. If the model drops too much, the raw text
 * is kept instead - a scrambled resume beats a truncated one.
 */
import { errorMessage } from "../../ai/jobs/run";
import { callLlmStrict } from "../../ai/llm";

const NORMALIZE_SYSTEM = `You are given raw text extracted from a resume PDF or DOCX. PDF text extraction reads content in the underlying file's internal draw order, not visual reading order - for multi-column or template-designed resumes this frequently scrambles the result: a company name, its job title, and its date range can end up in one disconnected cluster near the top, separated from the bullet points that actually belong to that role, with multiple roles' bullets appearing as separate unlabeled blocks later in the text.

Your job: reconstruct this into clean, correctly-ordered plain text - a faithful re-organization, NEVER a rewrite or summary. Rules, in order of importance:
1. Preserve every fact EXACTLY as written - names, dates, numbers, percentages, company names, job titles, URLs, emails, phone numbers, and the exact wording of every bullet point. Never invent, paraphrase, embellish, or drop anything. Every bullet present in the input must appear exactly once in the output, attached to the correct role.
2. When a company name, job title, and date range are disconnected from their bullets, use narrative/topical continuity to match each bullet block to the correct role (e.g. a bullet block about "migrating a PHP monolith" belongs with whichever role's tagline also mentions that migration) - infer the correct grouping from context, don't guess randomly, and don't merge two roles' bullets together.
3. Output structure, top to bottom: name, headline/title line, contact info line, then each section that existed in the input (e.g. Summary/About, Experience, Skills, Education, Projects, Certifications) using the exact section heading text from the input, in a sensible reading order. Within Experience, order roles reverse-chronologically if dates make that determinable, each shown as company name, then job title and date range, then only that role's own bullets.
4. Do not add any section, heading, sentence, or bullet that wasn't in the input. Do not fix, improve, or embellish any wording - only reorder and regroup.
5. Plain text only - no markdown symbols (no #, no **, no bullet characters other than "- " for existing bullet points).

Respond with ONLY the reconstructed resume text, nothing else.`;

export interface NormalizeResult {
  text: string;
  changed: boolean;
  /** Set when the cleanup was skipped or rejected, so the UI can say why. */
  warning?: string;
}

export async function normalizeResume(rawText: string): Promise<NormalizeResult> {
  const trimmed = rawText.trim();
  if (!trimmed) return { text: "", changed: false };

  let response;
  try {
    response = await callLlmStrict(NORMALIZE_SYSTEM, trimmed, false);
  } catch (error) {
    return {
      text: trimmed,
      changed: false,
      warning: `Cleanup failed, so the text is as extracted: ${errorMessage(error)}`,
    };
  }

  const normalized = response.text?.trim() ?? "";
  if (!normalized) {
    return {
      text: trimmed,
      changed: false,
      warning: "Cleanup returned nothing, so the text is as extracted.",
    };
  }
  if (normalized.length < trimmed.length * 0.5) {
    return { text: trimmed, changed: false, warning: "Cleanup dropped too much text, so it was discarded." };
  }

  return { text: normalized, changed: true };
}
