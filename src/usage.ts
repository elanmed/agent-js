import { z } from "zod";
import { actions, getState } from "./state.ts";
import { tryCatch } from "./utils.ts";
import { fsDeps } from "./deps.ts";
import assert from "node:assert";
import type { LanguageModelUsage } from "ai";
import { getUsageLogPath } from "./paths.ts";
import { dirname } from "node:path";

export const ModelUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  date: z.number(),
});
export type ModelUsage = z.infer<typeof ModelUsageSchema>;

const ModelUsageMapSchema = z.record(z.string(), z.array(ModelUsageSchema));

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const DOLLARS_PER_MILLION = 1_000_000;

export function appendModelUsage(usage: LanguageModelUsage) {
  const { model } = getState().config;
  const now = Date.now();

  const defaultedUsage: ModelUsage = {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
    date: now,
  };

  syncNewModelUsage(model, defaultedUsage);
}

export function usageLimitDisabled() {
  const { usageLimitDuration, usageLimitDollar, pricingPerModel, model } =
    getState().config;
  const pricing = pricingPerModel[model];

  return (
    pricing === undefined ||
    usageLimitDuration === undefined ||
    usageLimitDollar === undefined
  );
}

export function syncInitialModelUsage() {
  if (usageLimitDisabled()) return;

  const { usageLimitDuration } = getState().config;
  assert(usageLimitDuration !== undefined);

  const now = Date.now();
  const msPerDuration = {
    s: 1_000,
    m: 1_000 * 60,
    h: 1_000 * 60 * 60,
    d: 1_000 * 60 * 60 * 24,
  };
  const durationSuffix = usageLimitDuration.slice(
    -1,
  ) as keyof typeof msPerDuration;
  const durationPrefix = Number(usageLimitDuration.slice(0, -1));
  const duration = durationPrefix * msPerDuration[durationSuffix];
  const expiredTime = now - duration;

  const path = getUsageLogPath();
  const dir = dirname(path);
  if (!fsDeps.existsSync(dir)) return;

  const readResult = tryCatch(() => fsDeps.readFileSync(path).toString());
  if (!readResult.ok) {
    tryCatch(() => fsDeps.writeFileSync(path, JSON.stringify({})));
    return;
  }

  const parseResult = tryCatch(() =>
    ModelUsageMapSchema.parse(JSON.parse(readResult.value)),
  );
  if (!parseResult.ok) {
    tryCatch(() => fsDeps.writeFileSync(path, JSON.stringify({})));
    return;
  }
  const map = parseResult.value;

  const filtered: Record<string, ModelUsage[]> = {};
  for (const [model, modelUsage] of Object.entries(map)) {
    const kept = modelUsage.filter((usage) => usage.date >= expiredTime);
    if (kept.length > 0) filtered[model] = kept;
  }

  tryCatch(() => fsDeps.writeFileSync(path, JSON.stringify(filtered)));
  actions.setModelUsageForLimitWindow(filtered);
}

export function syncNewModelUsage(model: string, usage: ModelUsage) {
  if (usageLimitDisabled()) {
    actions.appendToModelUsageForLimitWindow(usage);
    return;
  }

  const path = getUsageLogPath();
  const dir = dirname(path);
  if (!fsDeps.existsSync(dir)) {
    tryCatch(() => fsDeps.mkdirSync(dir, { recursive: true }));
  }

  const readResult = tryCatch(() => fsDeps.readFileSync(path).toString());
  const loggedModelUsage = (() => {
    if (!readResult.ok) return {};
    const parseResult = tryCatch(() =>
      ModelUsageMapSchema.parse(JSON.parse(readResult.value)),
    );
    if (parseResult.ok) return parseResult.value;
    return {};
  })();

  (loggedModelUsage[model] ??= []).push(usage);
  tryCatch(() => fsDeps.writeFileSync(path, JSON.stringify(loggedModelUsage)));

  actions.setModelUsageForLimitWindow(loggedModelUsage);
}

export function getUsageMoneyForModel(usageTokens: TokenUsage, model: string) {
  const pricing = getState().config.pricingPerModel[model];
  if (pricing === undefined) return 0;

  const inputPerToken = pricing.inputPerToken;
  const outputPerToken = pricing.outputPerToken;
  const cacheReadPerToken = pricing.cacheReadPerToken ?? inputPerToken;
  const cacheWritePerToken = pricing.cacheWritePerToken ?? inputPerToken;

  const uncachedInputTokens =
    usageTokens.inputTokens -
    usageTokens.cacheReadTokens -
    usageTokens.cacheWriteTokens;
  const inputCost = (uncachedInputTokens * inputPerToken) / DOLLARS_PER_MILLION;
  const outputCost =
    (usageTokens.outputTokens * outputPerToken) / DOLLARS_PER_MILLION;
  const cacheReadCost =
    (usageTokens.cacheReadTokens * cacheReadPerToken) / DOLLARS_PER_MILLION;
  const cacheWriteCost =
    (usageTokens.cacheWriteTokens * cacheWritePerToken) / DOLLARS_PER_MILLION;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

export function getUsageTokensForModel(model: string): TokenUsage {
  return (getState().app.modelUsageForLimitWindow[model] ?? []).reduce<{
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }>(
    (accum, curr) => ({
      inputTokens: accum.inputTokens + curr.inputTokens,
      outputTokens: accum.outputTokens + curr.outputTokens,
      cacheReadTokens: accum.cacheReadTokens + curr.cacheReadTokens,
      cacheWriteTokens: accum.cacheWriteTokens + curr.cacheWriteTokens,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  );
}

export function getPrettyTokenUsage() {
  const { model } = getState().config;
  const pricing = getState().config.pricingPerModel[model];
  const tokenUsage = getUsageTokensForModel(model);
  if (pricing === undefined) {
    return `${(tokenUsage.inputTokens + tokenUsage.outputTokens).toLocaleString()} tokens total`;
  }

  const getPrettyMoney = (money: number) =>
    money.toLocaleString("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });

  const cost = getUsageMoneyForModel(tokenUsage, model);
  const { usageLimitDollar } = getState().config;

  if (usageLimitDisabled()) return `$${getPrettyMoney(cost)} total`;
  return `$${getPrettyMoney(cost)} of $${String(usageLimitDollar)}`;
}

export function getPrettyContextWindowUsage() {
  const { model } = getState().config;
  const contextWindow = getState().config.contextWindowPerModel[model];
  if (contextWindow === undefined) return "";

  const currRatio = getState().app.messageParams.tokens / contextWindow;
  const currPercent = String(Math.floor(currRatio * 100));
  return `${currPercent}% of context window`;
}

export function getPrettyUsage() {
  const tokenUsage = getPrettyTokenUsage();
  const contextWindowUsage = getPrettyContextWindowUsage();
  if (contextWindowUsage.length > 0) {
    return `${tokenUsage}, ${contextWindowUsage}`;
  }
  return tokenUsage;
}
