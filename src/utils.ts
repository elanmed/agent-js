import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fsDeps, type FsDeps } from "./fs-deps.ts";

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

export interface CreateTempFileDeps {
  tmpdir: () => string;
  randomUUID: () => string;
  fs: FsDeps;
}

export const createTempFileDeps: CreateTempFileDeps = {
  tmpdir,
  randomUUID,
  fs: fsDeps,
};

export function createTempFile(
  args?: { initialContentPath?: string },
  deps: CreateTempFileDeps = createTempFileDeps,
) {
  const tempFile = join(deps.tmpdir(), `agent-js-${deps.randomUUID()}.txt`);
  const initialContentPath = args?.initialContentPath;
  if (initialContentPath) {
    const readResult = tryCatch(() =>
      deps.fs.readFileSync(initialContentPath).toString(),
    );
    if (readResult.ok) {
      tryCatch(() => deps.fs.writeFileSync(tempFile, readResult.value));
    }
  }
  return tempFile;
}

export function stringify(val: unknown) {
  return JSON.stringify(val, null, 2);
}

