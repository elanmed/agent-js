import { actions, getState } from "./state.ts";
import { format } from "prettier";
import {
  tryCatch,
  tryCatchAsync,
  normalizeLine,
  execPromise,
  createQueue,
  getMessageFromError,
} from "./utils.ts";
import { processDeps } from "./deps.ts";
import childProcess from "node:child_process";
import assert from "node:assert";
import { getPrettyUsage } from "./usage.ts";

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
    if (color !== undefined) {
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
  showSessionInfo?: boolean;
  color?: Color;
}

export async function fencePrint(text: string, opts: FencePrintOpts = {}) {
  const showSessionInfo = opts.showSessionInfo ?? false;

  const line = (() => {
    if (!showSessionInfo) return `━━ ${text} ━━`;

    return `━━ ${text} (${getPrettyApiDuration()}) (${getPrettyUsage()}) ━━`;
  })();

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
  if (stoppingPromise !== null) return stoppingPromise;
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

function spawnBat(input: string) {
  return tryCatch(() =>
    childProcess.spawnSync(
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
      { input, encoding: "utf8" },
    ),
  );
}

export async function formatMarkdown(content: string): Promise<string> {
  const formatResult = await tryCatchAsync(
    format(content, { parser: "markdown" }),
  );
  if (formatResult.ok) return formatResult.value;
  await print.warning(
    `Outputting raw content, markdown formatting failed: ${getMessageFromError(formatResult.error)}`,
  );
  return content;
}

export async function executeBat(content: string) {
  content = await formatMarkdown(content);
  content = normalizeLine(content);
  const isBatAvailable = await checkBat();

  async function fallbackPrint(message: string) {
    await print.error(message);
    await print(content);
  }

  if (!isBatAvailable) {
    return await fallbackPrint(
      "`bat` is not available, falling back to plain text rendering",
    );
  }

  const baseMessage =
    "Falling back to plain text rendering, an error occurred when spawning `bat`: ";
  const batResult = spawnBat(content);
  if (!batResult.ok) {
    return await fallbackPrint(
      baseMessage.concat(getMessageFromError(batResult.error)),
    );
  }
  if (batResult.value.status !== null && batResult.value.status !== 0) {
    return await fallbackPrint(
      baseMessage.concat(
        `\`bat\` returned code ${String(batResult.value.status)}`,
      ),
    );
  }
  if (batResult.value.stderr.length !== 0) {
    return await fallbackPrint(baseMessage.concat(batResult.value.stderr));
  }
  await print(batResult.value.stdout);
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

export async function printSessionStartDate() {
  await print.info(
    `Resume this session with /resume ${String(getState().app.sessionStartDate)}`,
  );
}
