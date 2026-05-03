import { dirname, join } from "node:path";
import { selectors } from "./state.ts";
import { homedir } from "node:os";
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { normalizeLine, tryCatch } from "./utils.ts";

const DEBUG_LOG_PATH = join(process.cwd(), ".agent-js", "debug.log");
export const EDITOR_LOG_PATH = join(
  homedir(),
  ".config",
  ".agent-js",
  "editor.log",
);

export const debugLogDeps = {
  existsSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
  getDebugLogPath: () => DEBUG_LOG_PATH,
  getEditorLogPath: () => EDITOR_LOG_PATH,
};

export type DebugLogDeps = typeof debugLogDeps;

export function debugLog(content: string, deps: DebugLogDeps = debugLogDeps) {
  if (!selectors.getDebugLog()) return;

  const path = deps.getDebugLogPath();
  if (!deps.existsSync(path)) {
    const mkdirResult = tryCatch(() => {
      deps.mkdirSync(dirname(path), { recursive: true });
    });
    if (!mkdirResult.ok) return;
  }
  tryCatch(() => {
    deps.appendFileSync(path, `${new Date().toISOString()} :: ${content}\n`);
  });
}

export function editorLog(content: string, deps: DebugLogDeps = debugLogDeps) {
  if (!selectors.getEditorLog()) return;

  const path = deps.getEditorLogPath();
  if (!deps.existsSync(path)) {
    const mkdirResult = tryCatch(() => {
      deps.mkdirSync(dirname(path), { recursive: true });
    });
    if (!mkdirResult.ok) return;
  }
  tryCatch(() => {
    deps.appendFileSync(
      path,
      `${new Date().toISOString()}\n${"-".repeat(25)}\n${normalizeLine(content)}\n`,
    );
  });
}

export function resetDebugLog(deps: DebugLogDeps = debugLogDeps) {
  const path = deps.getDebugLogPath();
  if (deps.existsSync(path)) {
    tryCatch(() => {
      deps.writeFileSync(path, "");
    });
  }
}

export function resetEditorLog(deps: DebugLogDeps = debugLogDeps) {
  const path = deps.getEditorLogPath();
  if (deps.existsSync(path)) {
    tryCatch(() => {
      deps.writeFileSync(path, "");
    });
  }
}

export type DebugLog = typeof debugLog;
export type EditorLog = typeof editorLog;

export function initLogs() {
  resetDebugLog();
  resetEditorLog();
}
