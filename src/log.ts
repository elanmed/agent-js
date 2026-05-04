import { basename, dirname, extname, join } from "node:path";
import { actions, dispatch, selectors } from "./state.ts";
import { homedir } from "node:os";
import { normalizeLine, tryCatch } from "./utils.ts";
import { randomUUID } from "node:crypto";
import { fsDeps, type FsDeps } from "./fs-deps.ts";

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
  fs: FsDeps;
  getDebugLogPath: () => string;
  now: () => number;
}

export const debugLogDeps: DebugLogDeps = {
  fs: fsDeps,
  getDebugLogPath: () => DEBUG_LOG_PATH,
  now: () => Date.now(),
};

export function debugLog(content: string, deps: DebugLogDeps = debugLogDeps) {
  if (!selectors.getDebugLog()) return;

  const path = deps.getDebugLogPath();
  if (!deps.fs.existsSync(path)) {
    const mkdirResult = tryCatch(() =>
      deps.fs.mkdirSync(dirname(path), { recursive: true }),
    );
    if (!mkdirResult.ok) return;
  }
  tryCatch(() =>
    deps.fs.appendFileSync(
      path,
      `${new Date(deps.now()).toISOString()} :: ${content}\n`,
    ),
  );
}

export interface EditorLogDeps {
  fs: FsDeps;
  getEditorLogPath: () => string;
  getEditorLog: () => boolean;
  now: () => number;
}

export const editorLogDeps: EditorLogDeps = {
  fs: fsDeps,
  getEditorLogPath: () => selectors.getEditorLogPath(),
  getEditorLog: () => selectors.getEditorLog(),
  now: () => Date.now(),
};

export function editorLog(
  content: string,
  deps: EditorLogDeps = editorLogDeps,
) {
  if (!deps.getEditorLog()) return;

  const path = deps.getEditorLogPath();
  if (!deps.fs.existsSync(path)) {
    const mkdirResult = tryCatch(() =>
      deps.fs.mkdirSync(dirname(path), { recursive: true }),
    );
    if (!mkdirResult.ok) return;
  }
  tryCatch(() =>
    deps.fs.appendFileSync(
      path,
      `${new Date(deps.now()).toISOString()}
      ${"-".repeat(25)}
      ${normalizeLine(content)}
      `,
    ),
  );
}

export interface ResetDebugLogDeps {
  fs: FsDeps;
  getDebugLogPath: () => string;
}

export const resetDebugLogDeps: ResetDebugLogDeps = {
  fs: fsDeps,
  getDebugLogPath: () => DEBUG_LOG_PATH,
};

export function resetDebugLog(deps: ResetDebugLogDeps = resetDebugLogDeps) {
  const path = deps.getDebugLogPath();
  if (deps.fs.existsSync(path)) {
    tryCatch(() => deps.fs.writeFileSync(path, ""));
  }
}

export interface InitEditorLogDeps {
  fs: FsDeps;
  randomUUID: () => string;
  now: () => number;
}

export const initEditorLogDeps: InitEditorLogDeps = {
  fs: fsDeps,
  randomUUID,
  now: () => Date.now(),
};

export function initEditorLog(deps: InitEditorLogDeps = initEditorLogDeps) {
  if (!deps.fs.existsSync(EDITOR_LOGS_PATH)) {
    const mkdirResult = tryCatch(() => deps.fs.mkdirSync(EDITOR_LOGS_PATH));
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
  fs: FsDeps;
  now: () => number;
  getEditorLogsPath: () => string;
}

export const deleteExpiredEditorLogsDeps: DeleteExpiredEditorLogsDeps = {
  fs: fsDeps,
  now: () => Date.now(),
  getEditorLogsPath: () => EDITOR_LOGS_PATH,
};

export function deleteExpiredEditorLogs(
  deps: DeleteExpiredEditorLogsDeps = deleteExpiredEditorLogsDeps,
) {
  const editorLogsPath = deps.getEditorLogsPath();
  if (!deps.fs.existsSync(editorLogsPath)) return;

  for (const entry of deps.fs.readdirSync(editorLogsPath, {
    withFileTypes: true,
    recursive: true,
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
      tryCatch(() => deps.fs.unlinkSync(path));
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
