import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  unlinkSync,
  appendFileSync,
  statSync,
} from "node:fs";
import { generateText, isLoopFinished } from "ai";
import { globbySync } from "globby";
export const fsDeps = {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  unlinkSync,
  appendFileSync,
  statSync,
  globbySync: (pattern: string) => globbySync(pattern, { gitignore: true }),
};

export type FsDeps = typeof fsDeps;

export const processDeps = {
  env: {
    get: (key: string) => process.env[key],
  },
  stdout: {
    write: (out: string) => {
      process.stdout.write(out);
    },
  },
  cwd: () => process.cwd(),
};

export const aiDeps = {
  generateText,
  isLoopFinished,
};
