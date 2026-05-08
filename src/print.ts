import { spawnSync, exec } from "node:child_process";
import { promisify } from "node:util";
import { actions, dispatch, selectors } from "./state.ts";
import { format } from "prettier";
import { debugLog } from "./log.ts";
import {
  tryCatch,
  tryCatchAsync,
  normalizeLine,
  calculateSessionUsage,
  type Result,
} from "./utils.ts";

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

  process.stdout.write(out);
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

export const fencePrintDeps = {
  colorPrint,
};

export type FencePrintDeps = typeof fencePrintDeps;

export function fencePrint(
  text: string,
  opts: FencePrintOpts = {},
  deps: FencePrintDeps = fencePrintDeps,
) {
  let sessionUsage = "";
  if (!opts.skipSessionUsage && !selectors.getDisableUsageMessage()) {
    sessionUsage = ` (${calculateSessionUsage()})`;
  }
  let label = `${text}${sessionUsage}`;
  if (label.length >= 50) {
    label = label.slice(0, 46).concat("...");
  }
  const line = `── ${label} ${"─".repeat(50 - label.length)}`;
  deps.colorPrint(line, opts.color ?? "grey");
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
    process.stdout.write(
      `\r${String(SPINNER_FRAMES[spinnerIdx++ % SPINNER_FRAMES.length])}`,
    );
  }, 80);
  dispatch(actions.setSpinnerTimeout(timeout));
}

export function stopSpinner() {
  const timeout = selectors.getSpinnerTimeout();
  if (timeout === null) return;
  clearInterval(timeout);
  process.stdout.write("\r \r");
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

