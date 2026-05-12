import { mock } from "node:test";
import { fsDeps, processEnv, processStdout } from "./deps.ts";

export interface FakeFsDeps {
  _files: Map<string, string>;
  _dirs: Set<string>;
  _globResults: Map<string, string[]>;
  _restore: () => void;
  readFileSync: (path: string) => Buffer;
  writeFileSync: (path: string, content: string, options?: { signal?: AbortSignal }) => void;
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  unlinkSync: (path: string) => void;
  appendFileSync: (path: string, content: string, options?: { signal?: AbortSignal }) => void;
  statSync: (path: string) => { isFile: () => boolean; isDirectory: () => boolean };
  globSync: (pattern: string) => string[];
}

const EXCLUDED_KEYS = ["_files", "_dirs", "_globResults", "_restore"];

export function makeFakeFsDeps(
  overrides: Partial<FakeFsDeps> = {},
): FakeFsDeps {
  const _files = new Map<string, string>();
  const _dirs = new Set<string>();
  const _globResults = new Map<string, string[]>();

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
    unlinkSync: (path: string) => _files.delete(path),
    appendFileSync: (path: string, content: string) => {
      _files.set(path, (_files.get(path) ?? "") + content);
    },
    statSync: (path: string) => ({
      isFile: () => _files.has(path),
      isDirectory: () => _dirs.has(path),
    }),
    globSync: (pattern: string) => _globResults.get(pattern) ?? [],
    _restore: () => {
      _files.clear();
      _dirs.clear();
      _globResults.clear();
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

export const testFs = makeFakeFsDeps();
export const testProcessEnv = makeFakeProcessEnv();

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
  mock.method(processEnv, "get", (key: string) => testProcessEnv.get(key));
  mock.method(processStdout, "write", () => undefined);
}

