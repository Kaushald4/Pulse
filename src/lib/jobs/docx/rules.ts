/**
 * Recognising the plain-text resume convention.
 *
 * The writer model produces a simple structural shape (see
 * `ai/jobs/prompts.ts`) rather than markdown, and these are the rules that read
 * it back. Pure functions, no `docx` dependency, so they can be reasoned about
 * on their own.
 */

/** ALL CAPS section headings, e.g. "EXPERIENCE". */
const HEADING_LINE_RE = /^[A-Z][A-Z0-9 &/.'\-]{1,40}$/;

/**
 * Section names a model reaches for even when it drifts from the ALL CAPS
 * instruction (Title Case is the usual slip). Case-insensitive fallback so a
 * heading still gets its spacing instead of blending into body text.
 */
const KNOWN_SECTION_NAMES = new Set([
  "summary",
  "professional summary",
  "objective",
  "profile",
  "experience",
  "work experience",
  "professional experience",
  "employment history",
  "skills",
  "technical skills",
  "core competencies",
  "key skills",
  "education",
  "projects",
  "certifications",
  "certificates",
  "awards",
  "publications",
  "achievements",
  "languages",
  "interests",
  "volunteer experience",
  "references",
]);

export function isHeadingLine(line: string): boolean {
  const isAllCaps =
    HEADING_LINE_RE.test(line) && line === line.toUpperCase() && /[A-Z]/.test(line);
  if (isAllCaps) return true;
  return line.length <= 40 && KNOWN_SECTION_NAMES.has(line.toLowerCase());
}

/**
 * Sections that are a flat list of short tags, never prose - the only ones
 * where joining consecutive bare lines with a comma is safe. Models sometimes
 * ignore the "one comma-separated line" instruction and emit one skill per
 * line; without this each became its own paragraph and tripled the page count.
 */
export const TAG_LIST_SECTIONS = new Set([
  "skills",
  "technical skills",
  "core competencies",
  "key skills",
  "languages",
  "certifications",
  "certificates",
  "interests",
]);

/**
 * A trailing date range - "2024 – 2026", "2023 - Present" - anchored to the end
 * of the line whatever precedes it. Requiring an exact " | " missed the case
 * where the model ran the title and date together, which then fell through to
 * plain text with no aligned date.
 */
const DATE_TAIL_RE = /((?:19|20)\d{2}\s*[-–-]\s*(?:(?:19|20)\d{2}|present|current))\s*$/i;

export function parseTitleDate(line: string): { title: string; date: string } | null {
  const match = DATE_TAIL_RE.exec(line);
  if (!match) return null;

  const date = match[1].trim();
  const title = line
    .slice(0, match.index)
    .replace(/[|,\-–-]\s*$/, "")
    .trim();
  return title ? { title, date } : null;
}

/** A line that isn't a heading, a bullet, or a "Title | Date range". */
export function isPlainListLine(line: string): boolean {
  return !isHeadingLine(line) && !line.startsWith("- ") && !parseTitleDate(line);
}

/**
 * Emails and URLs are the one thing that must survive verbatim from the base
 * resume - this is what turns them back into real hyperlinks. Bare
 * `github.com/...` paths match too, since contact lines often drop the scheme.
 */
export const LINK_RE =
  /(https?:\/\/[^\s,;|]+|www\.[^\s,;|]+|(?:github|linkedin)\.com\/[^\s,;|]+|[\w.+-]+@[\w-]+\.[a-z]{2,})/gi;

export function toHref(match: string): string {
  if (/^https?:\/\//i.test(match)) return match;
  if (match.includes("@")) return `mailto:${match}`;
  return `https://${match}`;
}
