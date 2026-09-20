/**
 * Run accounting for jobs work.
 *
 * Every model call lands on the Logs page with its outcome and token cost,
 * which is why jobs share the content pipeline's `runs` table rather than
 * keeping a private log.
 */
import { finishRun, startRun } from "../../db/runs";
import type { TokenUse } from "../llm";

interface JobRunResult {
  error?: string;
  usage?: TokenUse | null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wraps one model call: records a `jobs` run before it starts, then finishes it
 * with either the caller's summary or the failure, tokens included.
 */
export async function withJobRun<T extends JobRunResult>(
  label: string,
  summarize: (result: T) => string,
  work: () => Promise<T>
): Promise<T> {
  const runId = await startRun({ category: "jobs", label });

  try {
    const result = await work();
    await finishRun(runId, {
      status: result.error ? "failed" : "success",
      summary: result.error ? null : summarize(result),
      error: result.error ?? null,
      model: result.usage?.model ?? null,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    });
    return result;
  } catch (error) {
    const message = errorMessage(error);
    await finishRun(runId, { status: "failed", error: message });
    throw error;
  }
}
