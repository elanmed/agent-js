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

  syncNewModelUsageForLimitWindow(model, defaultedUsage);
  actions.appendToModelUsageForSession(defaultedUsage);
}

export function isUsageLimitDisabled() {
  const { usageLimitDuration, usageLimitDollar, pricingPerModel, model } =
    getState().config;
  const pricing = pricingPerModel[model];

  return (
    pricing === undefined ||
    usageLimitDuration === undefined ||
    usageLimitDollar === undefined
  );
}

export function filterExpiredModelUsage(
  map: Record<string, ModelUsage[]>,
  expiredTime: number,
) {
  const filtered: Record<string, ModelUsage[]> = {};
  for (const [model, modelUsage] of Object.entries(map)) {
    const kept = modelUsage.filter((usage) => usage.date >= expiredTime);
    if (kept.length > 0) filtered[model] = kept;
  }
  return filtered;
}

export function getExpiredTime() {
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
  return expiredTime;
}

export function syncInitialModelUsageForLimitWindow() {
  if (isUsageLimitDisabled()) return;

  const { usageLimitDuration } = getState().config;
  assert(usageLimitDuration !== undefined);
  const expiredTime = getExpiredTime();

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
  const filtered = filterExpiredModelUsage(parseResult.value, expiredTime);

  tryCatch(() => fsDeps.writeFileSync(path, JSON.stringify(filtered)));
  actions.setModelUsageForLimitWindow(filtered);
}

export function syncNewModelUsageForLimitWindow(
  model: string,
  usage: ModelUsage,
) {
  if (isUsageLimitDisabled()) return;

  const expiredTime = getExpiredTime();

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

  const filtered = filterExpiredModelUsage(loggedModelUsage, expiredTime);

  tryCatch(() => fsDeps.writeFileSync(path, JSON.stringify(filtered)));

  actions.setModelUsageForLimitWindow(filtered);
}

export function getUsageMoneyForModel(usageTokens: TokenUsage, model: string) {
  const pricing = getState().config.pricingPerModel[model];
  assert(pricing !== undefined);

  const inputPerMillion = pricing.inputPerMillion;
  const outputPerMillion = pricing.outputPerMillion;
  const cacheReadPerMillion = pricing.cacheReadPerMillion ?? inputPerMillion;
  const cacheWritePerMillion = pricing.cacheWritePerMillion ?? inputPerMillion;

  const uncachedInputTokens =
    usageTokens.inputTokens -
    usageTokens.cacheReadTokens -
    usageTokens.cacheWriteTokens;
  const inputCost = (uncachedInputTokens * inputPerMillion) / DOLLARS_PER_MILLION;
  const outputCost =
    (usageTokens.outputTokens * outputPerMillion) / DOLLARS_PER_MILLION;
  const cacheReadCost =
    (usageTokens.cacheReadTokens * cacheReadPerMillion) / DOLLARS_PER_MILLION;
  const cacheWriteCost =
    (usageTokens.cacheWriteTokens * cacheWritePerMillion) / DOLLARS_PER_MILLION;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

export function sumUsageTokens(modelUsage: ModelUsage[]): TokenUsage {
  return modelUsage.reduce<{
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
  const tokenUsageForSession = sumUsageTokens(
    getState().app.modelUsageForSession[model] ?? [],
  );

  if (pricing === undefined) {
    return `${(tokenUsageForSession.inputTokens + tokenUsageForSession.outputTokens).toLocaleString()} tokens in session`;
  }

  const tokenUsageForLimitWindow = sumUsageTokens(
    getState().app.modelUsageForLimitWindow[model] ?? [],
  );

  const getPrettyMoney = (money: number) =>
    money.toLocaleString("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });

  const costForSession = getUsageMoneyForModel(tokenUsageForSession, model);
  const { usageLimitDollar } = getState().config;

  if (isUsageLimitDisabled())
    return `$${getPrettyMoney(costForSession)} in session`;

  const costForLimitWindow = getUsageMoneyForModel(
    tokenUsageForLimitWindow,
    model,
  );
  return `$${getPrettyMoney(costForSession)} in session, $${getPrettyMoney(costForLimitWindow)} of $${String(usageLimitDollar)} limit`;
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
