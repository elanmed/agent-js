import fs from "node:fs";
import { resolve } from "node:path";
import { selectors } from "./state.ts";

export type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function tryCatch<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    const result = await promise;
    return { ok: true, value: result };
  } catch (err) {
    return { ok: false, error: err };
  }
}

const COLORS = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  white: "\x1b[37m",
  grey: "\x1b[90m",
} as const;

export function colorLog(text: string, color: keyof typeof COLORS = "white") {
  const reset = "\x1b[0m";
  const colorCode = COLORS[color];
  console.log(`${colorCode}${text}${reset}`);
}

export function debugLog(content: string) {
  if (process.env["AGENT_JS_DEBUG"] !== "true") return;
  const path = resolve("agent-js.log");
  fs.appendFileSync(path, `${new Date().toISOString()} :: ${content}\n`);
  console.log(content);
}

export function logNewline(repeat = 1) {
  for (let i = 0; i < repeat; i++) console.log("");
}

export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cacheWrite5mPerToken: number;
  cacheWrite1hPerToken: number;
  cacheReadPerToken: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export type SupportedModel =
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";

export function calculateSessionCost(
  model: SupportedModel,
  usages: TokenUsage[],
): string {
  const DOLLARS_PER_MILLION = 1_000_000;
  const pricing = selectors.getPricingPerModel()[model];

  const {
    cacheReadPerToken,
    cacheWrite5mPerToken,
    inputPerToken,
    outputPerToken,
  } = pricing;

  const totalUsage = usages.reduce<{
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    input_tokens: number;
    output_tokens: number;
  }>(
    (accum, curr) => {
      return {
        cache_creation_input_tokens:
          accum.cache_creation_input_tokens +
          (curr.cache_creation_input_tokens ?? 0),
        cache_read_input_tokens:
          accum.cache_read_input_tokens + (curr.cache_read_input_tokens ?? 0),
        input_tokens: accum.input_tokens + curr.input_tokens,
        output_tokens: accum.output_tokens + curr.output_tokens,
      };
    },
    {
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
    },
  );

  const inputCost =
    (totalUsage.input_tokens * inputPerToken) / DOLLARS_PER_MILLION;
  const outputCost =
    (totalUsage.output_tokens * outputPerToken) / DOLLARS_PER_MILLION;
  const cacheCreationCost =
    (totalUsage.cache_creation_input_tokens * cacheWrite5mPerToken) /
    DOLLARS_PER_MILLION;
  const cacheReadCost =
    (totalUsage.cache_read_input_tokens * cacheReadPerToken) /
    DOLLARS_PER_MILLION;

  const cost = inputCost + outputCost + cacheCreationCost + cacheReadCost;
  return `Session cost: $${cost.toFixed(4)}`;
}
