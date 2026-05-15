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

export const fsDeps = {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  unlinkSync,
  appendFileSync,
  statSync,
  globSync,
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
