import { spawnSync, exec } from "node:child_process";
import { promisify } from "node:util";
import { actions, dispatch, selectors } from "./state.ts";
import { format } from "prettier";
import { debugLog } from "./log.ts";
import {
  tryCatch,
  tryCatchAsync,
  normalizeLine,
  type Result,
} from "./utils.ts";
import { type ModelPricing } from "./config.ts";
import { processDeps } from "./deps.ts";

export { processDeps };

const execPromise = promisify(exec);

const COLORS = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  grey: "\x1b[90m",
} as const;

export type Color = keyof typeof COLORS;

export function colorPrint(text: Uint8Array | string, color?: Color) {
  const reset = "\x1b[0m";
  let out: string;
  if (color) {
    const colorCode = COLORS[color];
    out = `${colorCode}${text.toString()}${reset}\n`;
  } else {
    out = `${text.toString()}\n`;
  }

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
  skipSessionUsage?: boolean;
  color?: Color;
}

export function fencePrint(text: string, opts: FencePrintOpts = {}) {
  let sessionUsage = "";
  if (!opts.skipSessionUsage) {
    sessionUsage = ` (${calculateSessionUsage()})`;
  }
  const line = `━━ ${text}${sessionUsage} ━━`;
  colorPrint(line, opts.color ?? "grey");
}

export function initPrint() {
  fencePrint("agent-js", { color: "green", skipSessionUsage: true });
  colorPrint(`model: ${selectors.getModel()}`, "grey");
  colorPrint(`diff-style: ${selectors.getDiffStyle()}`, "grey");
  colorPrint(
    `keymap-edit: ${JSON.stringify(selectors.getKeymapEdit())}`,
    "grey",
  );
  colorPrint(
    `keymap-edit-log: ${JSON.stringify(selectors.getKeymapEditLog())}`,
    "grey",
  );
  colorPrint(
    `keymap-clear: ${JSON.stringify(selectors.getKeymapClear())}`,
    "grey",
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
  try {
    return await format(content, { parser: "markdown" });
  } catch {
    return content;
  }
}

// NOTE: missing test coverage
export async function executeBat(content: string) {
  content = await formatMarkdown(content);
  content = normalizeLine(content);
  const isBatAvailable = await checkBat();
  debugLog(`executeBat: isBatAvailable=${String(isBatAvailable)}`);

  if (!isBatAvailable) {
    colorPrint(
      "`bat` is not available, falling back to plain text rendering",
      "red",
    );
    colorPrint(content);
    return;
  }

  const batResult = spawnBat(content);
  if (batResult.ok) {
    debugLog(
      `executeBat: writing bat output, bytes=${String(batResult.value.stdout.length)}`,
    );
    colorPrint(batResult.value.stdout);
    return;
  }

  debugLog("executeBat: bat spawn failed, falling back to plain text");
  colorPrint(content);
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
