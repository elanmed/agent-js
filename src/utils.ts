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

export function logNewline(repeat = 1) {
  for (let i = 0; i < repeat; i++) console.log("");
}

interface ModelPricing {
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

export function calculateSessionCost(
  model: string,
  usages: TokenUsage[],
): string {
  const DOLLARS_PER_MILLION = 1_000_000;

  const pricingPerModel: Partial<Record<string, ModelPricing>> = {
    "claude-opus-4-6": {
      inputPerToken: 5 / DOLLARS_PER_MILLION,
      cacheWrite5mPerToken: 6.25 / DOLLARS_PER_MILLION,
      cacheWrite1hPerToken: 10 / DOLLARS_PER_MILLION,
      cacheReadPerToken: 0.5 / DOLLARS_PER_MILLION,
      outputPerToken: 25 / DOLLARS_PER_MILLION,
    },
    "claude-sonnet-4-6": {
      inputPerToken: 3 / DOLLARS_PER_MILLION,
      cacheWrite5mPerToken: 3.75 / DOLLARS_PER_MILLION,
      cacheWrite1hPerToken: 6 / DOLLARS_PER_MILLION,
      cacheReadPerToken: 0.3 / DOLLARS_PER_MILLION,
      outputPerToken: 15 / DOLLARS_PER_MILLION,
    },
    "claude-haiku-4-5": {
      inputPerToken: 1 / DOLLARS_PER_MILLION,
      cacheWrite5mPerToken: 1.25 / DOLLARS_PER_MILLION,
      cacheWrite1hPerToken: 2 / DOLLARS_PER_MILLION,
      cacheReadPerToken: 0.1 / DOLLARS_PER_MILLION,
      outputPerToken: 5 / DOLLARS_PER_MILLION,
    },
  };

  const pricing = pricingPerModel[model];
  if (pricing === undefined) {
    return "Session cost: unknown";
  }

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

  const inputCost = totalUsage.input_tokens * inputPerToken;
  const outputCost = totalUsage.output_tokens * outputPerToken;
  const cacheCreationCost =
    totalUsage.cache_creation_input_tokens * cacheWrite5mPerToken;
  const cacheReadCost = totalUsage.cache_read_input_tokens * cacheReadPerToken;

  const cost = inputCost + outputCost + cacheCreationCost + cacheReadCost;
  return `Session cost: $${cost.toFixed(4)}`;
}

