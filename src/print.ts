import { actions, getState } from "./state.ts";
import { format } from "prettier";
import {
  tryCatch,
  tryCatchAsync,
  normalizeLine,
  execPromise,
  getMessageFromError,
} from "./utils.ts";
import { processDeps } from "./deps.ts";
import childProcess from "node:child_process";
import assert from "node:assert";
import { getPrettyUsage } from "./usage.ts";
import { getGlobalConfigPath, getLocalConfigPath } from "./paths.ts";

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
  const out = (() => {
    if (color !== undefined) {
      const colorCode = COLORS[color];
      return `${colorCode}${text.toString()}${reset}\n`;
    } else {
      return `${text.toString()}\n`;
    }
  })();

  const wasSpinnerActive = getState().app.loadingStateTimeout !== null;
  stopLoadingState();
  processDeps.stdout.write(out);
  if (wasSpinnerActive) startLoadingState();
  actions.appendToStdout(out);
}

export function printNewline() {
  if (getState().app.stdout.endsWith("\n\n")) return;
  colorPrint("");
}

interface FencePrintOpts {
  showSessionInfo?: boolean;
  color?: Color;
}

export function fencePrint(text: string, opts: FencePrintOpts = {}) {
  const showSessionInfo = opts.showSessionInfo ?? false;

  const line = (() => {
    if (!showSessionInfo) return `━━ ${text} ━━`;

    return `━━ ${text} (${getPrettyApiDuration()}) (${getPrettyUsage()}) ━━`;
  })();

  colorPrint(line, opts.color ?? "grey");
}

export function startLoadingState() {
  writeLoadingStateFrame();

  const timeout = setInterval(() => {
    writeLoadingStateFrame();
  }, getState().config.loadingStateFrameDuration);
  actions.setLoadingStateTimeout(timeout);
}

function writeLoadingStateFrame() {
  const { loadingStateFrames } = getState().config;
  processDeps.stdout.write(
    `\r${String(loadingStateFrames[getState().app.loadingStateFrameIdx % loadingStateFrames.length])}`,
  );
  actions.incrementLoadingStateFrameIdx();
}

export function stopLoadingState() {
  const { loadingStateTimeout } = getState().app;
  if (loadingStateTimeout === null) return;

  clearInterval(loadingStateTimeout);
  actions.setLoadingStateTimeout(null);

  processDeps.stdout.write(
    `\r${" ".repeat(getState().config.loadingStateFrames[0]?.length ?? 0)}\r`,
  );
  actions.resetLoadingStateFrameIdx();
}

export async function checkBat(): Promise<boolean> {
  return (await tryCatchAsync(execPromise("bat --version"))).ok;
}

export async function warnOnMissingBat() {
  if (getState().config.suppressBatUnavailableWarning) return;

  const isBatAvailable = await checkBat();
  if (!isBatAvailable) {
    print.warning(
      `\`bat\` is not available, consider installing it to properly render markdown responses in the terminal. Suppress this warning with \`suppressBatUnavailableWarning: true\` in ${getGlobalConfigPath()} or ${getLocalConfigPath()}`,
    );
  }
}

export async function checkDelta(): Promise<boolean> {
  return (await tryCatchAsync(execPromise("delta --version"))).ok;
}

export const baseBatFlags = ["--style=plain", "--color=always"];
export const markdownBatFlags = ["--language", "md", "--italic-text=always"];

function spawnBat(input: string) {
  return tryCatch(() =>
    childProcess.spawnSync(
      "bat",
      [...baseBatFlags, ...markdownBatFlags, "--paging=never", "-"],
      {
        input,
        encoding: "utf8",
      },
    ),
  );
}

export async function formatMarkdown(content: string): Promise<string> {
  const formatResult = await tryCatchAsync(
    format(content, { parser: "markdown" }),
  );
  if (formatResult.ok) return formatResult.value;
  print.warning(
    `Outputting raw content, markdown formatting failed: ${getMessageFromError(formatResult.error)}`,
  );
  return content;
}

export async function executeBat(content: string) {
  content = await formatMarkdown(content);
  content = normalizeLine(content);
  const isBatAvailable = await checkBat();

  if (!isBatAvailable) {
    return print(content);
  }

  function fallbackPrint(message: string) {
    print.error(message);
    print(content);
  }
  const baseMessage =
    "Falling back to plain text rendering, an error occurred when spawning `bat`: ";
  const batResult = spawnBat(content);
  if (!batResult.ok) {
    return fallbackPrint(
      baseMessage.concat(getMessageFromError(batResult.error)),
    );
  }
  if (batResult.value.status !== null && batResult.value.status !== 0) {
    return fallbackPrint(
      baseMessage.concat(
        `\`bat\` returned code ${String(batResult.value.status)}`,
      ),
    );
  }
  if (batResult.value.stderr.length !== 0) {
    return fallbackPrint(baseMessage.concat(batResult.value.stderr));
  }
  print(batResult.value.stdout);
}

export function getPrettyApiDuration() {
  const startTime = getState().app.apiStartTime;
  assert(startTime !== null);
  const endTime = getState().app.apiEndTime;
  assert(endTime !== null);

  const diff = Math.max(0, endTime - startTime);

  const ms = Math.floor(diff % 1000);
  const sec = Math.floor((diff / 1_000) % 60);
  const min = Math.floor(diff / 60_000);

  const prettyMs = `${String(ms)}ms`;

  const prettyMin = (() => {
    if (min > 0) {
      return `${String(min)}m `;
    }

    return "";
  })();

  const prettySec = (() => {
    if (sec > 0 || min > 0) {
      return `${String(sec)}s `;
    }

    return "";
  })();

  return `${prettyMin}${prettySec}${prettyMs}`;
}

export function printSessionStartDate() {
  print.info(
    `Resume this session with /resume ${String(getState().app.sessionStartDate)}`,
  );
}
