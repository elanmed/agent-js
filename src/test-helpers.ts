import os from "node:os";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import { mock } from "node:test";
import { fsDeps, processDeps } from "./deps.ts";
import { actions } from "./state.ts";
import readline from "node:readline/promises";

export interface FakeFsDeps {
  _files: Map<string, string>;
  _dirs: Set<string>;
  _globResults: Map<string, string[]>;
  _restore: () => void;
  readFileSync: (path: string) => Buffer;
  writeFileSync: (
    path: string,
    content: string,
    options?: { signal?: AbortSignal },
  ) => void;
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  unlinkSync: (path: string) => void;
  appendFileSync: (
    path: string,
    content: string,
    options?: { signal?: AbortSignal },
  ) => void;
  statSync: (path: string) => {
    isFile: () => boolean;
    isDirectory: () => boolean;
  };
  globbySync: (pattern: string) => string[];
}

const EXCLUDED_KEYS = ["_files", "_dirs", "_globResults", "_restore"];

export function makeFakeFsDeps(
  overrides: Partial<FakeFsDeps> = {},
): FakeFsDeps {
  const _files = new Map<string, string>();
  const _dirs = new Set<string>();
  const _globResults = new Map<string, string[]>();
  const _mtimes = new Map<string, number>();

  let _mtimeCounter = 0;

  return {
    _files,
    _dirs,
    _globResults,
    readFileSync: (path: string) => {
      const content = _files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return Buffer.from(content);
    },
    writeFileSync: (path: string, content: string) => {
      _files.set(path, content);
      _mtimes.set(path, ++_mtimeCounter);
    },
    existsSync: (path: string) => _files.has(path) || _dirs.has(path),
    readdirSync: (path: string) => {
      const prefix = path + "/";
      const result = new Set<string>();
      for (const filePath of _files.keys()) {
        if (filePath.startsWith(prefix)) {
          result.add(filePath.slice(prefix.length).split("/")[0]!);
        }
      }
      for (const dirPath of _dirs) {
        if (dirPath.startsWith(prefix)) {
          result.add(dirPath.slice(prefix.length).split("/")[0]!);
        }
      }
      return [...result];
    },
    mkdirSync: (path: string) => _dirs.add(path),
    unlinkSync: (path: string) => {
      _files.delete(path);
      _mtimes.delete(path);
    },
    appendFileSync: (path: string, content: string) => {
      _files.set(path, (_files.get(path) ?? "") + content);
      _mtimes.set(path, ++_mtimeCounter);
    },
    statSync: (path: string) => ({
      isFile: () => _files.has(path),
      isDirectory: () => _dirs.has(path),
      mtimeMs: _mtimes.get(path) ?? 0,
    }),
    globbySync: (pattern: string) => _globResults.get(pattern) ?? [],
    _restore: () => {
      _files.clear();
      _dirs.clear();
      _globResults.clear();
      _mtimes.clear();
      _mtimeCounter = 0;
    },
    ...overrides,
  };
}

export function makeFakeProcessEnv() {
  const map = new Map<string, string>();

  return {
    get(key: string) {
      return map.get(key);
    },
    _set(key: string, value: string) {
      return map.set(key, value);
    },
    _clear() {
      map.clear();
    },
  };
}

export function makeFakeCwd() {
  let cwd = "/test-cwd";
  return {
    _cwd: cwd,
    _set(val: string) {
      cwd = val;
    },
    get() {
      return cwd;
    },
  };
}

export const testFs = makeFakeFsDeps();
export const testProcessEnv = makeFakeProcessEnv();
export const testCwd = makeFakeCwd();

const ANSI_ESCAPE_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;]*m/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_ESCAPE_PATTERN, "");
}

export function setupFakeDeps() {
  testFs._restore();
  for (const key of Object.keys(testFs)) {
    if (!EXCLUDED_KEYS.includes(key)) {
      mock.method(
        fsDeps,
        key as keyof typeof fsDeps,
        testFs[key as keyof typeof testFs] as never,
      );
    }
  }

  testProcessEnv._clear();
  mock.method(processDeps.env, "get", (key: string) => testProcessEnv.get(key));
  mock.method(processDeps.stdout, "write", () => undefined);
  mock.method(processDeps, "cwd", () => testCwd.get());
}

export function makeFakeRl(overrides: object = {}) {
  return {
    write: () => null,
    prompt: () => null,
    line: "",
    close: () => null,
    question: () => Promise.resolve(""),
    ...overrides,
  } as unknown as readline.Interface;
}

export function setupTestContext() {
  actions.resetState();
  setupFakeDeps();
  mock.method(os, "homedir", () => "/fake-home");
  mock.method(os, "tmpdir", () => "/tmp");
  mock.method(crypto, "randomUUID", () => "test-uuid");
}

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

export function mockExec(opts: {
  stdout: string;
  error?: Error;
  once?: boolean;
}) {
  const { stdout, error, once } = opts;
  const impl = (_cmd: string, _opts: unknown, cb: ExecCallback) => {
    cb(error ?? null, stdout, "");
  };
  const m = mock.method(childProcess, "exec", impl);
  if (once) {
    m.mock.mockImplementationOnce(impl);
  }
}
