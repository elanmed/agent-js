import { dirname, join } from "node:path";
import { selectors } from "./state.ts";
import { homedir } from "node:os";
import fs from "node:fs";
import { normalizeLine } from "./utils.ts";

const DEBUG_LOG_PATH = join(process.cwd(), ".agent-js", "debug.log");
export const EDITOR_LOG_PATH = join(
  homedir(),
  ".config",
  ".agent-js",
  "editor.log",
);

export const debugLogDeps = {
  fs: {
    existsSync: (path: string): boolean => fs.existsSync(path),
    mkdirSync: (path: string, options?: { recursive: boolean }): void => {
      fs.mkdirSync(path, options);
    },
    appendFileSync: (path: string, content: string): void => {
      fs.appendFileSync(path, content);
    },
    writeFileSync: (path: string, content: string): void => {
      fs.writeFileSync(path, content);
    },
    readFileSync: (path: string): string => {
      return fs.readFileSync(path).toString();
    },
  },
  getDebugLogPath: () => DEBUG_LOG_PATH,
  getEditorLogPath: () => EDITOR_LOG_PATH,
};

export type DebugLogDeps = typeof debugLogDeps;

export function debugLog(content: string, deps: DebugLogDeps = debugLogDeps) {
  if (!selectors.getDebugLog()) return;

  const path = deps.getDebugLogPath();
  if (!deps.fs.existsSync(path)) {
    deps.fs.mkdirSync(dirname(path), { recursive: true });
  }
  deps.fs.appendFileSync(path, `${new Date().toISOString()} :: ${content}\n`);
}

export function editorLog(content: string, deps: DebugLogDeps = debugLogDeps) {
  if (!selectors.getEditorLog()) return;

  const path = deps.getEditorLogPath();
  if (!deps.fs.existsSync(path)) {
    deps.fs.mkdirSync(dirname(path), { recursive: true });
  }
  deps.fs.appendFileSync(
    path,
    `${new Date().toISOString()}\n${"-".repeat(25)}\n${normalizeLine(content)}\n`,
  );
}

export function resetDebugLog(deps: DebugLogDeps = debugLogDeps) {
  const path = deps.getDebugLogPath();
  if (deps.fs.existsSync(path)) {
    deps.fs.writeFileSync(path, "");
  }
}

export function resetEditorLog(deps: DebugLogDeps = debugLogDeps) {
  const path = deps.getEditorLogPath();
  if (deps.fs.existsSync(path)) {
    deps.fs.writeFileSync(path, "");
  }
}

export type DebugLog = typeof debugLog;
export type EditorLog = typeof editorLog;

export function initLogs() {
  resetDebugLog();
  resetEditorLog();
}
