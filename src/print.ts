import { actions, dispatch, selectors } from "./state.ts";
import { format } from "prettier";
import {
  tryCatch,
  tryCatchAsync,
  normalizeLine,
  execPromise,
  type Result,
  compute,
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

export function colorPrint(text: Uint8Array | string, color?: Color) {
  const reset = "\x1b[0m";
  const out = compute(() => {
    if (color) {
      const colorCode = COLORS[color];
      return `${colorCode}${text.toString()}${reset}\n`;
    } else {
      return `${text.toString()}\n`;
    }
  });

  const wasSpinnerActive = selectors.getSpinnerTimeout() !== null;
  stopSpinner();
  processDeps.stdout.write(out);
  if (wasSpinnerActive) startSpinner();

  dispatch(actions.appendToStdout(out));
}

export function printNewline() {
  if (selectors.getStdout().endsWith("\n\n")) return;
  colorPrint("");
}

interface FencePrintOpts {
  showSessionUsage?: boolean;
  showApiDuration?: boolean;
  color?: Color;
}

export function fencePrint(text: string, opts: FencePrintOpts = {}) {
  const showSessionUsage = opts.showSessionUsage ?? false;
  const showApiDuration = opts.showApiDuration ?? false;

  const sessionUsage = compute(() => {
    if (showSessionUsage) {
      return ` (${calculateSessionUsage()})`;
    }

    return "";
  });

  const apiDuration = compute(() => {
    if (showApiDuration) {
      return ` (${calculateApiDuration()})`;
    }

    return "";
  });

  const line = `━━ ${text}${sessionUsage}${apiDuration} ━━`;
  colorPrint(line, opts.color ?? "grey");
}

export function initPrint() {
  fencePrint("agent-js", { color: "green" });
  print.infoSubtle(`model: ${selectors.getModel()}`);
  print.infoSubtle(
    `keymap-edit: ${JSON.stringify(selectors.getKeymapEditPrompt())}`,
  );
  print.infoSubtle(
    `keymap-history: ${JSON.stringify(selectors.getKeymapPromptHistory())}`,
  );
  print.infoSubtle(
    `keymap-clear: ${JSON.stringify(selectors.getKeymapClear())}`,
  );
  print.infoSubtle(
    `keymap-edit-paste: ${JSON.stringify(selectors.getKeymapEditPastePrompt())}`,
  );
}

const SPINNER_FRAMES = ["|", "/", "-", "\\"];

export function startSpinner() {
  let spinnerIdx = 0;
  const timeout = setInterval(() => {
    processDeps.stdout.write(
      `\r${String(SPINNER_FRAMES[spinnerIdx++ % SPINNER_FRAMES.length])}`,
    );
  }, 80);
  dispatch(actions.setSpinnerTimeout(timeout));
}

export function stopSpinner() {
  const timeout = selectors.getSpinnerTimeout();
  if (timeout === null) return;
  clearInterval(timeout);
  processDeps.stdout.write("\r \r");
  dispatch(actions.setSpinnerTimeout(null));
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
    print.error("`bat` is not available, falling back to plain text rendering");
    print(content);
    return;
  }

  const batResult = spawnBat(content);
  if (batResult.ok) {
    print(batResult.value.stdout);
    return;
  }

  print(content);
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function calculateSessionUsage(): string {
  const model = selectors.getModel();
  const usages = selectors.getMessageUsages();
  const pricingPerModel = selectors.getPricingPerModel();

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
  const startTime = selectors.getApiStartTime();
  assert(startTime !== null);
  const endTime = selectors.getApiEndTime();
  assert(endTime !== null);

  const diff = endTime - startTime;
  const prettyMs = `${String(diff % 1_000)}ms`;

  const sec = Math.floor((diff / 1_000) % 60);
  const prettySec = compute(() => {
    if (sec > 0) {
      return `${String(sec)}s `;
    }

    return "";
  });

  const min = Math.floor(diff / 60_000);
  const prettyMin = compute(() => {
    if (min > 0) {
      return `${String(min)}m `;
    }

    return "";
  });

  return `${prettyMin}${prettySec}${prettyMs}`;
}
