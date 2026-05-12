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
  globSync: (pattern: string) => string[];
}

export const fsDeps: FsDeps = {
  readFileSync: (path) => readFileSync(path),
  writeFileSync: (path, content, options) =>
    writeFileSync(path, content, options),
  existsSync: (path) => existsSync(path),
  readdirSync: (path) => readdirSync(path),
  mkdirSync: (path, options) => mkdirSync(path, options),
  unlinkSync: (path) => unlinkSync(path),
  appendFileSync: (path, content, options) =>
    appendFileSync(path, content, options),
  statSync: (path) => statSync(path),
  globSync: (pattern) => globSync(pattern),
};

export const processEnv = {
  get: (key: string) => process.env[key],
};

export const processStdout = {
  write: (out: string) => {
    process.stdout.write(out);
  },
};

