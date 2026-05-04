import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  unlinkSync,
  appendFileSync,
  statSync,
  globSync,
} from "node:fs";

export interface FsDeps {
  readFileSync: (path: string) => Buffer;
  writeFileSync: (path: string, content: string) => void;
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  unlinkSync: (path: string) => void;
  appendFileSync: (path: string, content: string) => void;
  statSync: (path: string) => {
    isFile: () => boolean;
    isDirectory: () => boolean;
  };
  globSync: (pattern: string) => string[];
  _files: Map<string, string>;
  _dirs: Set<string>;
  _listings: Map<string, string[]>;
  _globResults: Map<string, string[]>;
}

export const fsDeps: FsDeps = {
  readFileSync: (path) => readFileSync(path),
  writeFileSync: (path, content) => writeFileSync(path, content),
  existsSync: (path) => existsSync(path),
  readdirSync: (path) => readdirSync(path),
  mkdirSync: (path, options) => mkdirSync(path, options),
  unlinkSync: (path) => unlinkSync(path),
  appendFileSync: (path, content) => appendFileSync(path, content),
  statSync: (path) => statSync(path),
  globSync: (pattern) => globSync(pattern),
  _files: new Map(),
  _dirs: new Set(),
  _listings: new Map(),
  _globResults: new Map(),
};

export function makeFsDeps(overrides: Partial<FsDeps> = {}) {
  const _files = new Map<string, string>();
  const _dirs = new Set<string>();
  const _listings = new Map<string, string[]>();
  const _globResults = new Map<string, string[]>();

  return {
    _files,
    _dirs,
    _listings,
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
    readdirSync: (path: string) => _listings.get(path) ?? [],
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
    ...overrides,
  } as FsDeps;
}
