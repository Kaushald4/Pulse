"use client";

/**
 * Jobs state.
 *
 * State and actions only - every piece of work lives in `lib/jobs/*`,
 * `lib/ai/jobs/*` or the db modules, so this file stays a thin seam between the
 * UI and the feature. Jobs are deliberately not part of the feed store.
 */
import { create } from "zustand";
import { generateCoverLetter, rewriteCoverLetter } from "../lib/ai/jobs/cover-letter";
import { generateTailoredResume, rewriteResumeSelection } from "../lib/ai/jobs/resume-writer";
import { scoreJobRelevance } from "../lib/ai/jobs/score";
import { getJob, getJobs, updateJob } from "../lib/db/jobs";
import {
  deleteGeneratedResume,
  getActiveResume,
  getCoverLetter,
  getCoverLetters,
  getGeneratedResume,
  getGeneratedResumes,
  updateGeneratedResumeContent,
} from "../lib/db/job-resumes";
import {
  deleteJobSource,
  getJobSources,
  saveJobSource,
  setJobSourceEnabled,
} from "../lib/db/job-sources";
import { saveResumeAsDocx } from "../lib/jobs/download";
import { fetchJobDescription } from "../lib/jobs/description";
import { addManualJob, type ManualJobInput, type ManualJobResult } from "../lib/jobs/manual";
import { scanJobs } from "../lib/jobs/scan";
import { uploadBaseResume } from "../lib/jobs/resume/upload";
import { DEFAULT_JOB_FILTER } from "../lib/jobs/types";
import type {
  BaseResume,
  CoverLetterTone,
  GeneratedResume,
  Job,
  JobCoverLetter,
  JobFilter,
  JobScanProgress,
  JobSource,
  JobStatus,
} from "../lib/jobs/types";
import { toast } from "../lib/toast";

/** Which long-running action is in flight, so one button can spin at a time. */
export type JobBusy =
  | "scan"
  | "resume"
  | "score"
  | "resume-write"
  | "letter"
  | "description"
  | null;

interface JobStore {
  ready: boolean;
  jobs: Job[];
  filter: JobFilter;
  sources: JobSource[];
  resume: BaseResume | null;
  busy: JobBusy;
  /** What a running scan is doing right now, stage by stage. */
  scanProgress: JobScanProgress | null;

  /** Null shows the list; set shows the job's full page. */
  selectedJobId: string | null;
  job: Job | null;
  drafts: GeneratedResume[];
  letters: JobCoverLetter[];

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  setFilter: (patch: Partial<JobFilter>) => Promise<void>;

  openJob: (id: string) => Promise<void>;
  closeJob: () => void;

  addJob: (input: ManualJobInput) => Promise<void>;
  scan: () => Promise<void>;

  setStatus: (status: JobStatus) => Promise<void>;
  saveDescription: (description: string) => Promise<void>;
  /** Reads the listing's own page for a description, then scores the job. */
  fetchDescription: () => Promise<void>;
  rescore: () => Promise<void>;

  uploadResume: () => Promise<void>;
  generateResume: () => Promise<void>;
  downloadResume: (draft: GeneratedResume) => Promise<void>;
  removeResume: (draftId: string) => Promise<void>;
  rewriteSelection: (draftId: string, selectedText: string) => Promise<string | null>;
  saveResumeContent: (draftId: string, content: string) => Promise<void>;

  generateLetter: () => Promise<void>;
  rewriteLetter: (letterId: string, tone: CoverLetterTone) => Promise<void>;

  toggleSource: (id: string, enabled: boolean) => Promise<void>;
  addTrackedCompany: (name: string, careersUrl: string) => Promise<void>;
  removeSource: (id: string) => Promise<void>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useJobs = create<JobStore>((set, get) => ({
  ready: false,
  jobs: [],
  filter: { ...DEFAULT_JOB_FILTER },
  sources: [],
  resume: null,
  busy: null,
  scanProgress: null,

  selectedJobId: null,
  job: null,
  drafts: [],
  letters: [],

  init: async () => {
    const [jobs, sources, resume] = await Promise.all([
      getJobs(get().filter),
      getJobSources(),
      getActiveResume(),
    ]);
    set({ jobs, sources, resume, ready: true });
  },

  refresh: async () => {
    const jobs = await getJobs(get().filter);
    set({ jobs });
  },

  setFilter: async (patch) => {
    set((state) => ({ filter: { ...state.filter, ...patch } }));
    await get().refresh();
  },

  openJob: async (id) => {
    const [job, drafts, letters] = await Promise.all([
      getJob(id),
      getGeneratedResumes(id),
      getCoverLetters(id),
    ]);
    set({ selectedJobId: id, job, drafts, letters });
  },

  closeJob: () => set({ selectedJobId: null, job: null, drafts: [], letters: [] }),

  addJob: async (input) => {
    try {
      const result: ManualJobResult = await addManualJob(input);
      await get().refresh();
      toast.success("Job added", result.scored ? `Scored ${result.job.title}` : undefined);
      await get().openJob(result.job.id);
    } catch (error) {
      toast.error("Could not add the job", message(error));
    }
  },

  scan: async () => {
    set({ busy: "scan", scanProgress: null });
    try {
      const report = await scanJobs((progress) => set({ scanProgress: progress }));
      await get().refresh();
      const parts = [`${report.found} found`];
      if (report.described > 0) parts.push(`${report.described} described`);
      if (report.scored > 0) parts.push(`${report.scored} scored`);
      const detail = parts.join(", ");
      if (report.errors.length > 0) {
        toast.error(`Scan finished with ${report.errors.length} problem(s)`, `${detail}. ${report.errors[0]}`);
      } else {
        toast.success("Scan complete", detail);
      }
    } catch (error) {
      toast.error("Scan failed", message(error));
    } finally {
      set({ busy: null, scanProgress: null });
    }
  },

  setStatus: async (status) => {
    const job = get().job;
    if (!job) return;
    await updateJob(job.id, { status });
    const updated = await getJob(job.id);
    set({ job: updated });
    await get().refresh();
  },

  saveDescription: async (description) => {
    const job = get().job;
    if (!job) return;
    await updateJob(job.id, { description });
    set({ job: await getJob(job.id) });
    await get().refresh();
    toast.success("Description saved");
  },

  fetchDescription: async () => {
    const job = get().job;
    if (!job) return;
    set({ busy: "description" });
    try {
      const result = await fetchJobDescription(job);
      if (!result.description) throw new Error(result.error ?? "No description found.");

      await updateJob(job.id, { description: result.description });
      set({ job: await getJob(job.id) });
      await get().refresh();
      toast.success(
        "Description fetched",
        result.engine ? `${result.description.length.toLocaleString()} characters via ${result.engine}` : undefined
      );

      // Now that there is something to read, score it.
      const score = await scoreJobRelevance(job.id);
      if (score.scored) set({ job: await getJob(job.id) });
    } catch (error) {
      toast.error("Could not fetch the description", message(error));
    } finally {
      set({ busy: null });
    }
  },

  rescore: async () => {
    const job = get().job;
    if (!job) return;
    set({ busy: "score" });
    try {
      const result = await scoreJobRelevance(job.id);
      if (!result.scored) throw new Error(result.error ?? "Scoring failed.");
      set({ job: await getJob(job.id) });
      await get().refresh();
      toast.success(`Scored ${result.score}/100`);
    } catch (error) {
      toast.error("Could not score this job", message(error));
    } finally {
      set({ busy: null });
    }
  },

  uploadResume: async () => {
    try {
      const result = await uploadBaseResume();
      if (result.cancelled) return;
      set({ resume: result.resume ?? null });
      if (result.warning) toast.info("Resume saved", result.warning);
      else toast.success("Resume saved", "Scoring and generation can use it now.");
    } catch (error) {
      toast.error("Could not read that file", message(error));
    }
  },

  generateResume: async () => {
    const job = get().job;
    if (!job) return;
    set({ busy: "resume-write" });
    try {
      const result = await generateTailoredResume(job.id);
      if (!result.generated) throw new Error(result.error ?? "Generation failed.");
      set({ drafts: await getGeneratedResumes(job.id) });
      toast.success("Resume generated", result.draft?.fileName);
    } catch (error) {
      toast.error("Could not generate a resume", message(error));
    } finally {
      set({ busy: null });
    }
  },

  downloadResume: async (draft) => {
    try {
      const path = await saveResumeAsDocx(draft.fileName, draft.content);
      if (path) toast.success("Saved", path);
    } catch (error) {
      toast.error("Could not save the document", message(error));
    }
  },

  removeResume: async (draftId) => {
    await deleteGeneratedResume(draftId);
    const job = get().job;
    if (job) set({ drafts: await getGeneratedResumes(job.id) });
  },

  rewriteSelection: async (draftId, selectedText) => {
    try {
      const result = await rewriteResumeSelection(draftId, selectedText);
      if (!result.rewritten) throw new Error(result.error ?? "Rewrite failed.");
      return result.text ?? null;
    } catch (error) {
      toast.error("Could not rewrite that", message(error));
      return null;
    }
  },

  saveResumeContent: async (draftId, content) => {
    await updateGeneratedResumeContent(draftId, content);
    const job = get().job;
    if (job) set({ drafts: await getGeneratedResumes(job.id) });
    toast.success("Changes saved");
  },

  generateLetter: async () => {
    const job = get().job;
    if (!job) return;
    set({ busy: "letter" });
    try {
      const result = await generateCoverLetter(job.id);
      if (!result.generated) throw new Error(result.error ?? "Generation failed.");
      set({ letters: await getCoverLetters(job.id) });
      toast.success("Cover letter generated");
    } catch (error) {
      toast.error("Could not generate a cover letter", message(error));
    } finally {
      set({ busy: null });
    }
  },

  rewriteLetter: async (letterId, tone) => {
    set({ busy: "letter" });
    try {
      const source = await getCoverLetter(letterId);
      if (!source) throw new Error("Cover letter not found.");
      const result = await rewriteCoverLetter(letterId, tone);
      if (!result.generated) throw new Error(result.error ?? "Rewrite failed.");
      set({ letters: await getCoverLetters(source.jobId) });
      toast.success(`Rewritten in a ${tone} tone`);
    } catch (error) {
      toast.error("Could not rewrite the letter", message(error));
    } finally {
      set({ busy: null });
    }
  },

  toggleSource: async (id, enabled) => {
    await setJobSourceEnabled(id, enabled);
    set({ sources: await getJobSources() });
  },

  addTrackedCompany: async (name, careersUrl) => {
    if (!name.trim() || !careersUrl.trim()) return;
    await saveJobSource({ name, careersUrl });
    set({ sources: await getJobSources() });
    toast.success("Source added", name.trim());
  },

  removeSource: async (id) => {
    await deleteJobSource(id);
    set({ sources: await getJobSources() });
  },
}));
