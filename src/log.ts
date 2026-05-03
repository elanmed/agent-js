import { basename, dirname, extname, join } from "node:path";
import { actions, dispatch, selectors } from "./state.ts";
import { homedir } from "node:os";
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  type Dirent,
} from "node:fs";
import { normalizeLine, tryCatch } from "./utils.ts";
import { randomUUID } from "node:crypto";

const DEBUG_LOG_PATH = join(process.cwd(), ".agent-js", "debug.log");
export const EDITOR_LOGS_PATH = join(
  homedir(),
  ".config",
  ".agent-js",
  "editor",
);

export const EDITOR_LOG_PATH = join(
  homedir(),
  ".config",
  ".agent-js",
  "editor.log",
);

export interface DebugLogDeps {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  appendFileSync: (path: string, content: string) => void;
  writeFileSync: (path: string, content: string) => void;
  readFileSync: (path: string) => Buffer | string;
  getDebugLogPath: () => string;
}

export const debugLogDeps: DebugLogDeps = {
  existsSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
  getDebugLogPath: () => DEBUG_LOG_PATH,
};

export function debugLog(content: string, deps: DebugLogDeps = debugLogDeps) {
  if (!selectors.getDebugLog()) return;

  const path = deps.getDebugLogPath();
  if (!deps.existsSync(path)) {
    const mkdirResult = tryCatch(() =>
      deps.mkdirSync(dirname(path), { recursive: true }),
    );
    if (!mkdirResult.ok) return;
  }
  tryCatch(() =>
    deps.appendFileSync(path, `${new Date().toISOString()} :: ${content}\n`),
  );
}

export interface EditorLogDeps {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  appendFileSync: (path: string, content: string) => void;
  normalizeLine: (content: string) => string;
  getEditorLogPath: () => string;
  getEditorLog: () => boolean;
}

export const editorLogDeps: EditorLogDeps = {
  existsSync,
  mkdirSync,
  appendFileSync,
  normalizeLine,
  getEditorLogPath: () => selectors.getEditorLogPath(),
  getEditorLog: () => selectors.getEditorLog(),
};

export function editorLog(
  content: string,
  deps: EditorLogDeps = editorLogDeps,
) {
  if (!deps.getEditorLog()) return;

  const path = deps.getEditorLogPath();
  if (!deps.existsSync(path)) {
    const mkdirResult = tryCatch(() =>
      deps.mkdirSync(dirname(path), { recursive: true }),
    );
    if (!mkdirResult.ok) return;
  }
  tryCatch(() =>
    deps.appendFileSync(
      path,
      `${new Date().toISOString()}
      ${"-".repeat(25)}
      ${deps.normalizeLine(content)}
      `,
    ),
  );
}

export interface ResetDebugLogDeps {
  getDebugLogPath: () => string;
  existsSync: (path: string) => boolean;
  writeFileSync: (path: string, content: string) => void;
}

export const resetDebugLogDeps: ResetDebugLogDeps = {
  getDebugLogPath: () => DEBUG_LOG_PATH,
  existsSync,
  writeFileSync,
};

export function resetDebugLog(deps: ResetDebugLogDeps = resetDebugLogDeps) {
  const path = deps.getDebugLogPath();
  if (deps.existsSync(path)) {
    tryCatch(() => deps.writeFileSync(path, ""));
  }
}

export interface InitEditorLogDeps {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string) => void;
  randomUUID: () => string;
  now: () => number;
}

export const initEditorLogDeps: InitEditorLogDeps = {
  existsSync,
  mkdirSync,
  randomUUID,
  now: () => Date.now(),
};

export function initEditorLog(deps: InitEditorLogDeps = initEditorLogDeps) {
  if (!deps.existsSync(EDITOR_LOGS_PATH)) {
    const mkdirResult = tryCatch(() => deps.mkdirSync(EDITOR_LOGS_PATH));
    if (!mkdirResult.ok) {
      dispatch(actions.setEditorLog(false));
      return;
    }
  }

  const editorLogSessionPath = join(
    EDITOR_LOGS_PATH,
    `editor-${deps.randomUUID()}-${deps.now().toString()}.log`,
  );
  dispatch(actions.setEditorLogPath(editorLogSessionPath));
}

export interface DeleteExpiredEditorLogsDeps {
  existsSync: (path: string) => boolean;
  readdirSync: (
    path: string,
    options: { recursive: boolean; withFileTypes: true },
  ) => Dirent[];
  unlinkSync: (path: string) => void;
  now: () => number;
  getEditorLogsPath: () => string;
}

export const deleteExpiredEditorLogsDeps: DeleteExpiredEditorLogsDeps = {
  existsSync,
  readdirSync,
  unlinkSync,
  now: () => Date.now(),
  getEditorLogsPath: () => EDITOR_LOGS_PATH,
};

export function deleteExpiredEditorLogs(
  deps: DeleteExpiredEditorLogsDeps = deleteExpiredEditorLogsDeps,
) {
  const editorLogsPath = deps.getEditorLogsPath();
  if (!deps.existsSync(editorLogsPath)) return;

  for (const entry of deps.readdirSync(editorLogsPath, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;

    const path = join(entry.parentPath, entry.name);
    const fileName = basename(entry.name, extname(entry.name));

    const parts = fileName.split("-");
    if (parts.length !== 3) continue;
    if (parts[0] !== "editor") continue;

    const date = Number(parts[2]);
    if (Number.isNaN(date)) continue;

    const oneDay = 1_000 * 60 * 60 * 24;
    if (date + oneDay < deps.now()) {
      tryCatch(() => deps.unlinkSync(path));
    }
  }
}

export type DebugLog = typeof debugLog;
export type EditorLog = typeof editorLog;

export function initLogs() {
  resetDebugLog();
  deleteExpiredEditorLogs();
  initEditorLog();
}
