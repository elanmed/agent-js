import { join } from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import { fsDeps } from "./deps.ts";

export const MISSING = "__MISSING__";

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

export function normalizeLine(content: string): string {
  return content.trim().concat("\n");
}

export function createTempFile(args?: { initialContentPath?: string }) {
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

export function compute<T>(cb: () => T) {
  return cb();
}
