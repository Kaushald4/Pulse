/**
 * LinkedIn job search, through helmsman.
 *
 * Reuses the LinkedIn connection already configured under Sources, so the
 * profile and keywords are set up once and shared. Listings arrive without a
 * description - LinkedIn only exposes that on the job page behind a login, and
 * helmsman has no detail command - which is exactly why the job screen has a
 * description editor.
 */
import { upsertJobs } from "../db/jobs";
import { getSources } from "../db/sources";
import { runHelmsman } from "../sources/helmsman";
import { parseRelativeTime } from "./relative-time";
import type { JobDraft } from "./types";

export interface LinkedInScanResult {
  found: number;
  errors: string[];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function fetchLinkedInJobs(): Promise<LinkedInScanResult> {
  const source = (await getSources()).find((entry) => entry.source === "linkedin");
  if (!source?.profileName) {
    return { found: 0, errors: ["LinkedIn is not set up - add it under Sources first."] };
  }

  const keywords = source.options?.keywords?.trim() || "Software Engineer";
  const limit = source.options?.limit ?? 15;
  const location = source.options?.location?.trim();

  const args = ["jobs", source.profileName, keywords, "--limit", String(limit)];
  if (location) args.push("--location", location);

  const rows = await runHelmsman("linkedin", args);
  const drafts: JobDraft[] = [];

  for (const row of rows) {
    const title = text(row?.title);
    const url = text(row?.jobUrl);
    if (!title || !url) continue;

    drafts.push({
      source: "linkedin",
      externalId: url,
      jobUrl: url,
      title,
      company: text(row?.company),
      location: text(row?.location),
      workplaceType: text(row?.workplaceType),
      description: null,
      postedAt: parseRelativeTime(text(row?.postedAt)),
    });
  }

  await upsertJobs(drafts);
  return { found: drafts.length, errors: [] };
}
