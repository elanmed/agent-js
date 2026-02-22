import fs from "node:fs";
import { dirname, join, parse } from "node:path";
import { selectors } from "./state.ts";
import { globby } from "globby";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execPromise = promisify(exec);

export type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
  white: "\x1b[37m",
  grey: "\x1b[90m",
} as const;

export function colorLog(text: string, color: keyof typeof COLORS = "white") {
  const reset = "\x1b[0m";
  const colorCode = COLORS[color];
  console.log(`${colorCode}${text}${reset}`);
}

export async function getRecursiveAgentsMdFilesStr() {
  const agentFiles = await globby("**/AGENTS.md", { gitignore: true });
  debugLog(`AGENTS.md found: ${agentFiles.join(",")}`);
  const filesContents = [];
  for (const filePath of agentFiles) {
    const fileContent = fs.readFileSync(filePath).toString();
    filesContents.push(`FILEPATH: ${filePath}`, fileContent);
  }
  return filesContents.join("\n");
}

export function debugLog(content: string) {
  if (process.env["AGENT_JS_DEBUG"] !== "true") return;
  const path = join(process.cwd(), ".agent-js", "debug.log");
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.appendFileSync(path, `${new Date().toISOString()} :: ${content}\n`);
}

export function logNewline(repeat = 1) {
  for (let i = 0; i < repeat; i++) console.log("");
}

export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cacheWrite5mPerToken: number;
  cacheWrite1hPerToken: number;
  cacheReadPerToken: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export type SupportedModel =
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";

export function calculateSessionCost(
  model: SupportedModel,
  usages: TokenUsage[],
): string {
  const DOLLARS_PER_MILLION = 1_000_000;
  const pricing = selectors.getPricingPerModel()[model];

  const {
    cacheReadPerToken,
    cacheWrite5mPerToken,
    inputPerToken,
    outputPerToken,
  } = pricing;

  const totalUsage = usages.reduce<{
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    input_tokens: number;
    output_tokens: number;
  }>(
    (accum, curr) => {
      return {
        cache_creation_input_tokens:
          accum.cache_creation_input_tokens +
          (curr.cache_creation_input_tokens ?? 0),
        cache_read_input_tokens:
          accum.cache_read_input_tokens + (curr.cache_read_input_tokens ?? 0),
        input_tokens: accum.input_tokens + curr.input_tokens,
        output_tokens: accum.output_tokens + curr.output_tokens,
      };
    },
    {
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
    },
  );

  const inputCost =
    (totalUsage.input_tokens * inputPerToken) / DOLLARS_PER_MILLION;
  const outputCost =
    (totalUsage.output_tokens * outputPerToken) / DOLLARS_PER_MILLION;
  const cacheCreationCost =
    (totalUsage.cache_creation_input_tokens * cacheWrite5mPerToken) /
    DOLLARS_PER_MILLION;
  const cacheReadCost =
    (totalUsage.cache_read_input_tokens * cacheReadPerToken) /
    DOLLARS_PER_MILLION;

  const cost = inputCost + outputCost + cacheCreationCost + cacheReadCost;
  return `Session cost: $${cost.toFixed(4)}`;
}

export const BASE_SYSTEM_PROMPT =
  "You are an AI agent being called from a minimal terminal cli. Keep your responses brief as to not pollute the terminal. CRITICAL: All your responses will be parsed by bat as markdown, your responses must be formatted as valid markdown.";

export function maybePrintCostMessage() {
  if (selectors.getDisableCostMessage()) return;

  logNewline();
  colorLog(
    calculateSessionCost(selectors.getModel(), selectors.getMessageUsages()),
    "green",
  );
}

export function getAvailableSlashCommands() {
  const path = join(process.cwd(), ".agent-js", "commands");
  if (!fs.existsSync(path)) return [];

  const files = fs.readdirSync(path);
  return files.map((file) => parse(file).name);
}

export function readFromEditor() {
  const tempFile = join(tmpdir(), `agent-js-${String(Date.now())}.txt`);
  const editor = process.env["EDITOR"] ?? "vi";
  fs.writeFileSync(tempFile, "");
  spawnSync(editor, [tempFile], { shell: true, stdio: "inherit" });
  const content = fs.readFileSync(tempFile).toString();
  fs.unlinkSync(tempFile);

  return content.trim();
}

async function checkBat(): Promise<boolean> {
  return (await tryCatchAsync(execPromise("bat --version"))).ok;
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

export async function executeBat(
  content: string,
  {
    checkBat: checkBatFn = checkBat,
    spawnBat: spawnBatFn = spawnBat,
  }: {
    checkBat?: () => Promise<boolean>;
    spawnBat?: (input: string) => Result<{ stdout: Buffer | string }>;
  } = {},
) {
  debugLog(`executeBat: content.length=${String(content.length)}`);
  const isBatAvailable = await checkBatFn();
  debugLog(`executeBat: isBatAvailable=${String(isBatAvailable)}`);

  if (!isBatAvailable) {
    colorLog(
      "`bat` is not available, falling back to plain text rendering",
      "red",
    );
    process.stdout.write(content);
    debugLog("executeBat: rendered as plain text (bat unavailable)");
    return;
  }

  const batResult = spawnBatFn(content);
  debugLog(`executeBat: batResult.ok=${String(batResult.ok)}`);

  if (batResult.ok) {
    debugLog(
      `executeBat: writing bat output, bytes=${String(batResult.value.stdout.length)}`,
    );
    process.stdout.write(batResult.value.stdout);
    return;
  }

  debugLog("executeBat: bat spawn failed, falling back to plain text");
  process.stdout.write(content);
}

