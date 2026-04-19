import fs from "node:fs";
import { dirname, join, parse } from "node:path";
import { actions, dispatch, selectors } from "./state.ts";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Key } from "./config.ts";

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

export function colorLog(
  text: Uint8Array | string,
  color?: keyof typeof COLORS,
) {
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

const fenceLogDeps = {
  colorLog,
  getColumns: () => (process.stdout.isTTY ? process.stdout.columns : 25),
};

type FenceLogDeps = typeof fenceLogDeps;

export function fenceLog(text: string, deps: FenceLogDeps = fenceLogDeps) {
  const fenceWidth = deps.getColumns();
  const leftPad = 2;
  const rightPad = 2;
  let sessionUsage = "";
  if (!selectors.getDisableUsageMessage()) {
    sessionUsage = ` (${calculateSessionUsage(
      selectors.getModel(),
      selectors.getMessageUsages(),
    )})`;
  }
  const label = ` ${text}${sessionUsage} `;
  const usedWidth = leftPad + label.length + rightPad;
  const rightFill = Math.max(fenceWidth - usedWidth, 0);
  const line = `${"─".repeat(leftPad)}${label}${"─".repeat(rightFill)}`;
  deps.colorLog(line, "grey");
}

export async function getRecursiveAgentsMdFilesStr() {
  const agentFiles = [];
  for await (const file of glob("**/AGENTS.md")) {
    agentFiles.push(file);
  }

  debugLog(`AGENTS.md found: ${agentFiles.join(",")}`);
  const filesContents = [];
  for (const filePath of agentFiles) {
    const fileContent = fs.readFileSync(filePath).toString();
    filesContents.push(`FILEPATH: ${filePath}`, fileContent);
  }
  return filesContents.join("\n");
}

export function debugLog(content: string) {
  if (!selectors.getDebug()) return;

  const path = join(process.cwd(), ".agent-js", "debug.log");
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.appendFileSync(path, `${new Date().toISOString()} :: ${content}\n`);
}

export function logNewline() {
  if (selectors.getStdout().endsWith("\n\n")) return;
  colorLog("");
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

export function calculateSessionUsage(
  model: string,
  usages: TokenUsage[],
): string {
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

  const pricing = selectors.getPricingPerModel()[model];
  if (!pricing) {
    return `${totalUsage.inputTokens.toLocaleString()} in, ${totalUsage.outputTokens.toLocaleString()} out`;
  }

  const DOLLARS_PER_MILLION = 1_000_000;
  const { inputPerToken, outputPerToken } = pricing;
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

export const BASE_SYSTEM_PROMPT =
  "You are an AI agent being called from a minimal terminal cli. Keep your responses brief as to not pollute the terminal. CRITICAL: All your responses will be parsed by bat as markdown, your responses MUST be formatted as valid markdown.";

export function maybePrintUsageMessage() {
  if (selectors.getDisableUsageMessage()) return;

  logNewline();
  colorLog(
    calculateSessionUsage(selectors.getModel(), selectors.getMessageUsages()),
    "grey",
  );
}

export function getAvailableSlashCommands() {
  const path = join(process.cwd(), ".agent-js", "commands");
  if (!fs.existsSync(path)) return [];

  const files = fs.readdirSync(path);
  return files.map((file) => parse(file).name);
}

export function readFromEditor(currentLine: string) {
  const tempFile = createTempFile();
  const editor =
    process.env["AGENT_JS_EDITOR"] ?? process.env["EDITOR"] ?? "vi";
  fs.writeFileSync(tempFile, currentLine);
  spawnSync(`${editor} "${tempFile}"`, { shell: true, stdio: "inherit" });
  const content = fs.readFileSync(tempFile).toString();
  fs.unlinkSync(tempFile);

  return normalizeLine(content);
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

export async function executeBat(content: string) {
  content = normalizeLine(content);
  const isBatAvailable = await checkBat();
  debugLog(`executeBat: isBatAvailable=${String(isBatAvailable)}`);

  if (!isBatAvailable) {
    colorLog(
      "`bat` is not available, falling back to plain text rendering",
      "red",
    );
    colorLog(content);
    return;
  }

  const batResult = spawnBat(content);
  if (batResult.ok) {
    debugLog(
      `executeBat: writing bat output, bytes=${String(batResult.value.stdout.length)}`,
    );
    colorLog(batResult.value.stdout);
    return;
  }

  debugLog("executeBat: bat spawn failed, falling back to plain text");
  colorLog(content);
}

export function createTempFile(args?: { initialContentPath?: string }) {
  const tempFile = join(tmpdir(), `agent-js-${randomUUID()}.txt`);
  if (args?.initialContentPath) {
    const content = fs.readFileSync(args.initialContentPath).toString();
    fs.writeFileSync(tempFile, content);
  }
  return tempFile;
}

export async function printGitDiff(args: {
  tempFileBeforePath: string;
  tempFileAfterPath: string;
  path: string;
}) {
  const diffArgs =
    selectors.getDiffStyle() === "lines"
      ? `${args.tempFileBeforePath} ${args.tempFileAfterPath}`
      : `--stat ${args.tempFileBeforePath} ${args.tempFileAfterPath}`;

  const diffResult = await tryCatchAsync(execGitDiff(diffArgs));
  if (diffResult.ok && diffResult.value.stdout) {
    fenceLog("File edit");
    colorLog(args.path, "blue");
    colorLog(normalizeLine(diffResult.value.stdout));
  }
}

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
