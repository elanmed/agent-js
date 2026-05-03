import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, parse } from "node:path";
import { actions, dispatch, selectors } from "./state.ts";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Key, ModelPricing } from "./config.ts";
import { format } from "prettier";
import { debugLog } from "./log.ts";
import type readline from "node:readline/promises";
import assert from "node:assert";

export const MISSING = "MISSING";

const execPromise = promisify(exec);

export type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function getMessageFromError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return JSON.stringify(error);
}

export function tryCatch<T>(cb: () => T): Result<T> {
  try {
    const result = cb();
    return { ok: true, value: result };
  } catch (err) {
    return { ok: false, error: err };
  }
}

export async function tryCatchAsync<T>(
  promise: Promise<T>,
): Promise<Result<T>> {
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
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  grey: "\x1b[90m",
} as const;

export type ColorPrint = typeof colorPrint;
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

export interface GetRecursiveAgentsMdFilesStrDeps {
  glob: (pattern: string) => AsyncIterable<string>;
  readFileSync: (path: string) => Buffer;
  debugLog: (content: string) => void;
}

export const getRecursiveAgentsMdFilesStrDeps: GetRecursiveAgentsMdFilesStrDeps =
  {
    glob,
    readFileSync,
    debugLog,
  };

export async function getRecursiveAgentsMdFilesStr(
  deps: GetRecursiveAgentsMdFilesStrDeps = getRecursiveAgentsMdFilesStrDeps,
) {
  const agentFiles = [];
  for await (const file of deps.glob("**/AGENTS.md")) {
    agentFiles.push(file);
  }

  deps.debugLog(`AGENTS.md found: ${agentFiles.join(",")}`);
  const filesContents = [];
  for (const filePath of agentFiles) {
    const readResult = tryCatch(() => deps.readFileSync(filePath).toString());
    if (readResult.ok) {
      filesContents.push(`FILEPATH: ${filePath}`, readResult.value);
    }
  }
  return filesContents.join("\n");
}

export function normalizeLine(content: string): string {
  return content.trim().concat("\n");
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

export const BASE_SYSTEM_PROMPT = `
You are an AI agent being called from a minimal terminal cli. 

- Keep responses under 25 words unless the task requires detail.
- No filler: omit "I'll help", "Sure", "Here is", etc.
- Answer in 1 sentence when possible
- For code edits: show only the change, no description
- Questions get answers only, no padding
- When giving commands for debugging, give one command at a time - not multiple.

CRITICAL: All responses will be parsed by bat as markdown, you MUST format as valid markdown.
`;

export interface GetAvailableSlashCommandsDeps {
  getCwd: () => string;
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
}

export const getAvailableSlashCommandsDeps: GetAvailableSlashCommandsDeps = {
  getCwd: () => process.cwd(),
  existsSync: (path) => existsSync(path),
  readdirSync: (path) => readdirSync(path),
};

export function getAvailableSlashCommands(
  deps: GetAvailableSlashCommandsDeps = getAvailableSlashCommandsDeps,
) {
  const path = join(deps.getCwd(), ".agent-js", "commands");
  if (!deps.existsSync(path)) return [];

  const readdirResult = tryCatch(() => deps.readdirSync(path));
  if (!readdirResult.ok) return [];
  return readdirResult.value.map((file) => parse(file).name);
}

async function checkBat(): Promise<boolean> {
  return (await tryCatchAsync(execPromise("bat --version"))).ok;
}

async function checkDelta(): Promise<boolean> {
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

export interface CreateTempFileDeps {
  tmpdir: () => string;
  randomUUID: () => string;
  join: (...segments: string[]) => string;
  readFileSync: (path: string) => Buffer;
  writeFileSync: (path: string, content: string) => void;
}

export const createTempFileDeps: CreateTempFileDeps = {
  tmpdir,
  randomUUID,
  join,
  readFileSync,
  writeFileSync,
};

export function createTempFile(
  args?: { initialContentPath?: string },
  deps: CreateTempFileDeps = createTempFileDeps,
) {
  const tempFile = deps.join(
    deps.tmpdir(),
    `agent-js-${deps.randomUUID()}.txt`,
  );
  const initialContentPath = args?.initialContentPath;
  if (initialContentPath) {
    const readResult = tryCatch(() =>
      deps.readFileSync(initialContentPath).toString(),
    );
    if (readResult.ok) {
      tryCatch(() => deps.writeFileSync(tempFile, readResult.value));
    }
  }
  return tempFile;
}

// NOTE: missing test coverage
export async function execGitDiff(
  args: string,
): Promise<{ stdout: string; stderr: string }> {
  debugLog(`execGitDiff: args=${args}`);
  const isDeltaAvailable = await checkDelta();
  debugLog(`execGitDiff: isDeltaAvailable=${String(isDeltaAvailable)}`);

  return new Promise((resolve, reject) => {
    const gitDiffCmd = `git diff --no-index ${args}`;
    debugLog(`execGitDiff: gitDiffCmd=${gitDiffCmd}`);

    if (isDeltaAvailable) {
      const deltaCmd = `delta --paging=never --line-numbers --hunk-header-style=omit --file-style=omit`;
      exec(`${gitDiffCmd} | ${deltaCmd}`, (error, stdout, stderr) => {
        if (error && error.code !== 1) {
          debugLog(
            `execGitDiff: error with delta, code=${String(error.code)}, message=${error.message}`,
          );
          reject(error);
        } else {
          debugLog(
            `execGitDiff: success with delta, stdout.length=${String(stdout.length)}`,
          );
          resolve({ stdout, stderr });
        }
      });
      return;
    }

    const coloredGitDiffCmd = `${gitDiffCmd} --color=always`;
    exec(coloredGitDiffCmd, (error, stdout, stderr) => {
      if (error && error.code !== 1) {
        debugLog(
          `execGitDiff: error without delta, code=${String(error.code)}, message=${error.message}`,
        );
        reject(error);
      } else {
        debugLog(
          `execGitDiff: success without delta, stdout.length=${String(stdout.length)}`,
        );
        resolve({ stdout, stderr });
      }
    });
  });
}

export function stringify(val: unknown) {
  return JSON.stringify(val, null, 2);
}

export function isSameKey(a: Key, b: Key) {
  return (
    a.name === b.name &&
    (a.ctrl ?? false) === (b.ctrl ?? false) &&
    (a.meta ?? false) === (b.meta ?? false) &&
    (a.shift ?? false) === (b.shift ?? false)
  );
}

export function clearRlLine(): readline.Interface | null {
  const rl = selectors.getRl();
  assert(rl !== null);
  rl.write(null, { ctrl: true, name: "e" });
  rl.write(null, { ctrl: true, name: "u" });
  return rl;
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
