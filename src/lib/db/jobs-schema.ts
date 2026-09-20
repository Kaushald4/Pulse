/**
 * Job tables.
 *
 * Separate from the content tables on purpose: jobs are their own feature, with
 * their own screens, and nothing here is ever read by the feed.
 */
export async function ensureJobSchema(db: any): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT,
      job_url TEXT,
      title TEXT NOT NULL,
      company TEXT,
      location TEXT,
      workplace_type TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'saved',
      relevance_score INTEGER,
      relevance_reasoning TEXT,
      posted_at TEXT,
      created_at TEXT,
      status_updated_at TEXT,
      closed_at TEXT
    );
  `);
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_external ON jobs(source, external_id);`
  );
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_jobs_posted ON jobs(posted_at DESC);`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS job_resumes (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      parsed_text TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      uploaded_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS job_resume_drafts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      base_resume_id TEXT,
      content TEXT NOT NULL,
      file_name TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_job_resume_drafts_job ON job_resume_drafts(job_id);`
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS job_cover_letters (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      content TEXT NOT NULL,
      tone TEXT,
      generated_at TEXT NOT NULL
    );
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_job_cover_letters_job ON job_cover_letters(job_id);`
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS job_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT,
      careers_url TEXT,
      api TEXT,
      max_pages INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
}
