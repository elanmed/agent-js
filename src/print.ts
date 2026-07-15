import { actions, getState } from "./state.ts";
import { format } from "prettier";
import {
  tryCatch,
  tryCatchAsync,
  normalizeLine,
  execPromise,
  type Result,
} from "./utils.ts";
import { type ModelPricing } from "./config.ts";
import { processDeps } from "./deps.ts";
import { spawnSync } from "node:child_process";
import assert from "node:assert";

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

  const wasSpinnerActive = getState().app.loadingStateTimeout !== null;
  await stopLoadingState();
  processDeps.stdout.write(out);
  if (wasSpinnerActive) startLoadingState();

  actions.appendToStdout(out);
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
      return ` (${calculateSessionUsage()})`;
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
  const timeout = setInterval(() => {
    writeLoadingStateFrame();
  }, 80);
  actions.setLoadingStateTimeout(timeout);
}

function clearLoadingState() {
  const { loadingStateTimeout } = getState().app;
  if (loadingStateTimeout === null) return;
  clearInterval(loadingStateTimeout);
  actions.setLoadingStateTimeout(null);
}

function writeLoadingStateFrame() {
  const { loadingStateFrames } = getState().config;
  processDeps.stdout.write(
    `\r${String(loadingStateFrames[getState().app.loadingStateFrameIdx % loadingStateFrames.length])}`,
  );
  actions.incrementLoadingStateFrameIdx();
}

export function stopLoadingState(): Promise<void> {
  if (getState().app.loadingStateTimeout === null) return Promise.resolve();
  clearLoadingState();

  const { loadingStateFrames } = getState().config;
  if (getState().app.loadingStateFrameIdx % loadingStateFrames.length === 0) {
    processDeps.stdout.write("\r \r");
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setInterval(() => {
      writeLoadingStateFrame();

      if (
        getState().app.loadingStateFrameIdx % loadingStateFrames.length ===
        0
      ) {
        clearLoadingState();
        processDeps.stdout.write("\r \r");
        resolve();
      }
    }, 80);
    actions.setLoadingStateTimeout(timeout);
  });
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

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function calculateSessionUsage(): string {
  const model = getState().config.model;
  const usages = getState().app.messageUsages;
  const pricingPerModel = getState().config.pricingPerModel;

  const totalUsage = usages.reduce<{
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

  const pricing: ModelPricing | undefined = pricingPerModel[model];
  if (!pricing) {
    return `${totalUsage.inputTokens.toLocaleString()} in, ${totalUsage.outputTokens.toLocaleString()} out`;
  }

  const DOLLARS_PER_MILLION = 1_000_000;
  const inputPerToken = pricing.inputPerToken;
  const outputPerToken = pricing.outputPerToken;
  const cacheReadPerToken = pricing.cacheReadPerToken ?? inputPerToken;
  const cacheWritePerToken = pricing.cacheWritePerToken ?? outputPerToken;

  const inputCost =
    (totalUsage.inputTokens * inputPerToken) / DOLLARS_PER_MILLION;
  const outputCost =
    (totalUsage.outputTokens * outputPerToken) / DOLLARS_PER_MILLION;
  const cacheReadCost =
    (totalUsage.cacheReadTokens * cacheReadPerToken) / DOLLARS_PER_MILLION;
  const cacheWriteCost =
    (totalUsage.cacheWriteTokens * cacheWritePerToken) / DOLLARS_PER_MILLION;

  const cost = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  return `$${cost.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

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
