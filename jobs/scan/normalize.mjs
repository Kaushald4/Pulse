/**
 * Provider output → the shape Pulse stores.
 *
 * Mirrors sync's `job-providers.ts`: a listing with no company falls back to
 * the entry's label, and anything older than 45 days is dropped. A job with no
 * date at all is kept - most providers don't report one at list-page level, and
 * "unknown age" isn't evidence of staleness.
 */
const MAX_JOB_AGE_MS = 45 * 24 * 60 * 60 * 1000;

export function isStale(postedAtMs) {
  return postedAtMs !== undefined && Date.now() - postedAtMs > MAX_JOB_AGE_MS;
}

/** `providerId` becomes the job's source; the URL is its dedup key. */
export function normalizeJob(job, providerId, entryName) {
  return {
    source: providerId,
    externalId: job.url,
    jobUrl: job.url,
    title: job.title.trim(),
    company: job.company?.trim() || entryName,
    location: job.location?.trim() || null,
    workplaceType: null,
    description: job.description?.trim() || null,
    postedAt: job.postedAt ? new Date(job.postedAt).toISOString() : null,
  };
}
