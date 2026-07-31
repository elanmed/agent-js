import { z } from "zod";
import { actions, getState } from "./state.ts";
import { format } from "prettier";
import {
  tryCatch,
  tryCatchAsync,
  normalizeLine,
  execPromise,
  createQueue,
  type Result,
} from "./utils.ts";

import { fsDeps, processDeps } from "./deps.ts";
import { spawnSync } from "node:child_process";
import assert from "node:assert";
import type { LanguageModelUsage } from "ai";
import { getUsageLogPath } from "./paths.ts";
import { dirname } from "node:path";

const printQueue = createQueue();

export function flushAndStopLoadingState(): Promise<void> {
  return printQueue.enqueue(() => stopLoadingState());
}

const COLORS = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  purple: "\x1b[35m",
  white: "\x1b[37m",
  grey: "\x1b[90m",
} as const;

export type Color = keyof typeof COLORS;

export const print = Object.assign(
  (text: Uint8Array | string) => colorPrint(text),
  {
    doing: (text: Uint8Array | string) => colorPrint(text, "blue"),
    error: (text: Uint8Array | string) => colorPrint(text, "red"),
    info: (text: Uint8Array | string) => colorPrint(text, "purple"),
    infoSubtle: (text: Uint8Array | string) => colorPrint(text, "grey"),
    warning: (text: Uint8Array | string) => colorPrint(text, "yellow"),
  },
);

export async function colorPrint(text: Uint8Array | string, color?: Color) {
  const reset = "\x1b[0m";
  const out = (() => {
    if (color) {
      const colorCode = COLORS[color];
      return `${colorCode}${text.toString()}${reset}\n`;
    } else {
      return `${text.toString()}\n`;
    }
  })();

  return printQueue.enqueue(async () => {
    const wasSpinnerActive = getState().app.loadingStateTimeout !== null;
    await stopLoadingState();
    processDeps.stdout.write(out);
    if (wasSpinnerActive) startLoadingState();
    actions.appendToStdout(out);
  });
}

export async function printNewline() {
  if (getState().app.stdout.endsWith("\n\n")) return;
  await colorPrint("");
}

interface FencePrintOpts {
  showSessionUsage?: boolean;
  showApiDuration?: boolean;
  color?: Color;
}

export async function fencePrint(text: string, opts: FencePrintOpts = {}) {
  const showSessionUsage = opts.showSessionUsage ?? false;
  const showApiDuration = opts.showApiDuration ?? false;

  const sessionUsage = (() => {
    if (showSessionUsage) {
      return ` (${getPrettySessionUsage()})`;
    }

    return "";
  })();

  const apiDuration = (() => {
    if (showApiDuration) {
      return ` (${calculateApiDuration()})`;
    }

    return "";
  })();

  const line = `━━ ${text}${sessionUsage}${apiDuration} ━━`;
  await colorPrint(line, opts.color ?? "grey");
}

export function startLoadingState() {
  writeLoadingStateFrame();

  const timeout = setInterval(() => {
    writeLoadingStateFrame();
  }, getState().config.loadingStateFrameDuration);
  actions.setLoadingStateTimeout(timeout);
}

function pauseLoadingState() {
  const { loadingStateTimeout } = getState().app;
  assert(loadingStateTimeout !== null);
  clearInterval(loadingStateTimeout);
  actions.setLoadingStateTimeout(null);
}

function eraseLoadingState() {
  processDeps.stdout.write(
    `\r${" ".repeat(getState().config.loadingStateFrames[0]?.length ?? 0)}\r`,
  );
  actions.resetLoadingStateFrameIdx();
}

function writeLoadingStateFrame() {
  const { loadingStateFrames } = getState().config;
  processDeps.stdout.write(
    `\r${String(loadingStateFrames[getState().app.loadingStateFrameIdx % loadingStateFrames.length])}`,
  );
  actions.incrementLoadingStateFrameIdx();
}

let stoppingPromise: Promise<void> | null = null;

export function stopLoadingState(): Promise<void> {
  if (stoppingPromise) return stoppingPromise;
  if (getState().app.loadingStateTimeout === null) {
    return Promise.resolve();
  }
  pauseLoadingState();

  const { loadingStateFrames } = getState().config;
  if (getState().app.loadingStateFrameIdx % loadingStateFrames.length === 1) {
    eraseLoadingState();
    return Promise.resolve();
  }

  stoppingPromise = new Promise((resolve) => {
    const timeout = setInterval(() => {
      writeLoadingStateFrame();

      if (
        getState().app.loadingStateFrameIdx % loadingStateFrames.length ===
        1
      ) {
        pauseLoadingState();
        eraseLoadingState();
        stoppingPromise = null;
        resolve();
      }
    }, getState().config.loadingStateFrameDuration);
    actions.setLoadingStateTimeout(timeout);
  });
  return stoppingPromise;
}

async function checkBat(): Promise<boolean> {
  return (await tryCatchAsync(execPromise("bat --version"))).ok;
}

export async function checkDelta(): Promise<boolean> {
  return (await tryCatchAsync(execPromise("delta --version"))).ok;
}

function spawnBat(input: string): Result<{ stdout: Buffer | string }> {
  return tryCatch(() =>
    spawnSync(
      "bat",
      [
        "--language",
        "md",
        "--paging=never",
        "--italic-text=always",
        "--style=plain",
        "--color=always",
        "-",
      ],
      { input },
    ),
  );
}

export async function formatMarkdown(content: string): Promise<string> {
  const formatResult = await tryCatchAsync(
    format(content, { parser: "markdown" }),
  );
  if (formatResult.ok) return formatResult.value;
  return content;
}

export async function executeBat(content: string) {
  content = await formatMarkdown(content);
  content = normalizeLine(content);
  const isBatAvailable = await checkBat();

  if (!isBatAvailable) {
    await print.error(
      "`bat` is not available, falling back to plain text rendering",
    );
    await print(content);
    return;
  }

  const batResult = spawnBat(content);
  if (batResult.ok) {
    await print(batResult.value.stdout);
    return;
  }

  await print(content);
}

export const IncrementalUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  date: z.number(),
});
export type IncrementalUsage = z.infer<typeof IncrementalUsageSchema>;

const IncrementalUsageMapSchema = z.record(
  z.string(),
  z.array(IncrementalUsageSchema),
);

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const DOLLARS_PER_MILLION = 1_000_000;

export function calculateApiDuration() {
  const startTime = getState().app.apiStartTime;
  assert(startTime !== null);
  const endTime = getState().app.apiEndTime;
  assert(endTime !== null);

  const diff = endTime - startTime;
  const prettyMs = `${String(diff % 1_000)}ms`;

  const sec = Math.floor((diff / 1_000) % 60);
  const prettySec = (() => {
    if (sec > 0) {
      return `${String(sec)}s `;
    }

    return "";
  })();

  const min = Math.floor(diff / 60_000);
  const prettyMin = (() => {
    if (min > 0) {
      return `${String(min)}m `;
    }

    return "";
  })();

  return `${prettyMin}${prettySec}${prettyMs}`;
}

export function appendIncrementalUsage(usage: LanguageModelUsage) {
  const { model } = getState().config;
  const now = Date.now();

  const defaultedUsage: IncrementalUsage = {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
    date: now,
  };

  syncNewIncrementalUsage(model, defaultedUsage);
}

export function syncInitialIncrementalUsages() {
  const { usageLimitMs } = getState().config;
  if (usageLimitMs === undefined) return;

  const now = Date.now();
  const expiredTime = now - usageLimitMs;

  const path = getUsageLogPath();
  const dir = dirname(path);
  if (!fsDeps.existsSync(dir)) return;

  const readResult = tryCatch(() => fsDeps.readFileSync(path).toString());
  if (!readResult.ok) {
    tryCatch(() => fsDeps.writeFileSync(path, JSON.stringify({})));
    return;
  }

  const parseResult = tryCatch(() =>
    IncrementalUsageMapSchema.parse(JSON.parse(readResult.value)),
  );
  if (!parseResult.ok) {
    tryCatch(() => fsDeps.writeFileSync(path, JSON.stringify({})));
    return;
  }
  const map = parseResult.value;

  const filtered: Record<string, IncrementalUsage[]> = {};
  for (const [model, usages] of Object.entries(map)) {
    const kept = usages.filter((usage) => usage.date >= expiredTime);
    if (kept.length > 0) filtered[model] = kept;
  }

  tryCatch(() => fsDeps.writeFileSync(path, JSON.stringify(filtered)));
  actions.setUsages(filtered);
}

export function syncNewIncrementalUsage(
  model: string,
  usage: IncrementalUsage,
) {
  const path = getUsageLogPath();
  const dir = dirname(path);
  if (!fsDeps.existsSync(dir)) {
    tryCatch(() => fsDeps.mkdirSync(dir, { recursive: true }));
  }

  const readResult = tryCatch(() => fsDeps.readFileSync(path).toString());
  const currUsage = (() => {
    if (!readResult.ok) return {};
    const parseResult = tryCatch(() =>
      IncrementalUsageMapSchema.parse(JSON.parse(readResult.value)),
    );
    if (parseResult.ok) return parseResult.value;
    return {};
  })();

  (currUsage[model] ??= []).push(usage);
  tryCatch(() => fsDeps.writeFileSync(path, JSON.stringify(currUsage)));

  actions.appendToUsages(model, usage);
}

export function getUsageMoneyForModel(usageTokens: TokenUsage, model: string) {
  const pricing = getState().config.pricingPerModel[model];
  if (!pricing) return 0;

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
  return (getState().app.incrementalUsage[model] ?? []).reduce<{
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

export function getPrettySessionUsage() {
  const { model } = getState().config;
  const pricing = getState().config.pricingPerModel[model];
  const tokenUsage = getUsageTokensForModel(model);
  if (!pricing) {
    return `${tokenUsage.inputTokens.toLocaleString()} in, ${tokenUsage.outputTokens.toLocaleString()} out`;
  }

  const getPrettyMoney = (money: number) =>
    money.toLocaleString("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });

  const cost = getUsageMoneyForModel(tokenUsage, model);
  const { usageLimitDollar } = getState().config;

  if (usageLimitDollar === undefined) return `$${getPrettyMoney(cost)}`;
  return `$${getPrettyMoney(cost)} of $${String(usageLimitDollar)}`;
}
