import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fsDeps } from "./fs-deps.ts";

export const MISSING = "MISSING";

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
  const tempFile = join(tmpdir(), `agent-js-${randomUUID()}.txt`);
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

export function stringify(val: unknown) {
  return JSON.stringify(val, null, 2);
}

