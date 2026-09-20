/**
 * Token accounting across providers.
 *
 * Every provider Pulse talks to is OpenAI-compatible, and OpenAI-shaped
 * responses report `prompt_tokens` / `completion_tokens`. Some endpoints (and
 * Anthropic-style APIs) use `input_tokens` / `output_tokens` instead, so accept
 * both rather than silently recording a run as zero-token.
 */
export interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export function readUsage(usage: RawUsage | null | undefined): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
  };
}
