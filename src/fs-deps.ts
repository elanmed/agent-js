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
};
