import { basename, extname, join } from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import { fsDeps, processDeps } from "./deps.ts";
import { getPromptHistoryDir } from "./paths.ts";

export const MISSING = "__MISSING__";

export type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function getMessageFromError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  const json = JSON.stringify(error) as string | undefined;
  return json ?? String(error);
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

export function normalizeLine(content: string): string {
  return content.trim().concat("\n");
}

export function getTempFileName(args?: { initialContentPath?: string }) {
  const tempFile = join(os.tmpdir(), `agent-js-${crypto.randomUUID()}.txt`);
  const initialContentPath = args?.initialContentPath;
  if (initialContentPath) {
    const readResult = tryCatch(() =>
      fsDeps.readFileSync(initialContentPath).toString(),
    );
    if (readResult.ok) {
      tryCatch(() => fsDeps.writeFileSync(tempFile, readResult.value));
    }
  }
  return tempFile;
}

export function execPromise(
  command: string,
  options?: { signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    childProcess.exec(
      command,
      { encoding: "utf8", ...options },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });
}

export function stringify(val: unknown) {
  return JSON.stringify(val, null, 2);
}

export function isExisty(val: unknown) {
  return val !== undefined && val !== null;
}

export function createQueue() {
  let queue: Promise<void> = Promise.resolve();

  function enqueue(fn: () => Promise<void>): Promise<void> {
    queue = queue.then(fn, fn);
    return queue;
  }

  function flush(): Promise<void> {
    return queue;
  }

  return { enqueue, flush };
}

export function truncate(str: string) {
  const maxLen = 0.9 * processDeps.stdout.getColumns();
  const newlineIdx = str.indexOf("\n");

  const firstLine = (() => {
    if (newlineIdx === -1) return str;
    return str.substring(0, newlineIdx);
  })();

  if (newlineIdx !== -1) {
    return firstLine.substring(0, maxLen).concat("…");
  }

  if (str.length <= maxLen) {
    return firstLine;
  }

  return firstLine.substring(0, maxLen).concat("…");
}

interface ChatHistoryEntry {
  absolutePath: string;
  timestampMs: number;
}

export function listChatHistoryFiles() {
  const chatHistoryPath = getPromptHistoryDir();
  if (!fsDeps.existsSync(chatHistoryPath)) return [];

  const chatHistoryFiles: ChatHistoryEntry[] = [];
  for (const name of fsDeps.readdirSync(chatHistoryPath)) {
    const fullPath = join(chatHistoryPath, name);
    const statResult = tryCatch(() => fsDeps.statSync(fullPath));
    if (!statResult.ok) continue;
    if (!statResult.value.isFile()) continue;

    const fileName = basename(name, extname(name));
    const parts = fileName.split("-");
    if (parts.length !== 3) continue;
    if (parts[0] !== "chat" || parts[1] !== "history") continue;

    const timestampMs = Number(parts[2]);
    if (Number.isNaN(timestampMs)) continue;

    if (extname(name) !== ".txt") continue;

    chatHistoryFiles.push({
      absolutePath: fullPath,
      timestampMs,
    });
  }
  return chatHistoryFiles;
}
