import { basename, dirname, extname, join } from "node:path";
import { actions, dispatch, selectors } from "./state.ts";
import { normalizeLine, tryCatch } from "./utils.ts";
import crypto from "node:crypto";
import { fsDeps } from "./deps.ts";
import { getDebugLogPath, getEditorLogsDir } from "./paths.ts";

export function debugLog(content: string) {
  if (!selectors.getDebugLog()) return;

  const path = getDebugLogPath();
  if (!fsDeps.existsSync(path)) {
    const mkdirResult = tryCatch(() =>
      fsDeps.mkdirSync(dirname(path), { recursive: true }),
    );
    if (!mkdirResult.ok) return;
  }
  tryCatch(() =>
    fsDeps.appendFileSync(
      path,
      `${new Date(Date.now()).toISOString()} :: ${content}\n`,
    ),
  );
}

export function editorLog(content: string) {
  if (!selectors.getEditorLog()) return;

  const path = selectors.getEditorLogPath();
  if (!fsDeps.existsSync(path)) {
    const mkdirResult = tryCatch(() =>
      fsDeps.mkdirSync(dirname(path), { recursive: true }),
    );
    if (!mkdirResult.ok) return;
  }
  tryCatch(() =>
    fsDeps.appendFileSync(
      path,
      `${new Date(Date.now()).toISOString()}
${"-".repeat(25)}
${normalizeLine(content)}
`,
    ),
  );
}

export function resetDebugLog() {
  const path = getDebugLogPath();
  if (fsDeps.existsSync(path)) {
    tryCatch(() => fsDeps.writeFileSync(path, ""));
  }
}

export function initEditorLog() {
  const editorLogsDir = getEditorLogsDir();
  if (!fsDeps.existsSync(editorLogsDir)) {
    const mkdirResult = tryCatch(() =>
      fsDeps.mkdirSync(editorLogsDir, { recursive: true }),
    );
    if (!mkdirResult.ok) {
      dispatch(actions.setEditorLog(false));
      return;
    }
  }

  const uuid = crypto.randomUUID().replaceAll("-", "");
  const editorLogSessionPath = join(
    editorLogsDir,
    `editor-${uuid}-${Date.now().toString()}.log`,
  );
  dispatch(actions.setEditorLogPath(editorLogSessionPath));
}

export function deleteExpiredEditorLogs() {
  const editorLogsPath = getEditorLogsDir();
  if (!fsDeps.existsSync(editorLogsPath)) return;

  for (const name of fsDeps.readdirSync(editorLogsPath)) {
    const fullPath = join(editorLogsPath, name);
    const statResult = tryCatch(() => fsDeps.statSync(fullPath));
    if (!statResult.ok) continue;
    if (!statResult.value.isFile()) continue;

    const fileName = basename(name, extname(name));
    const parts = fileName.split("-");
    if (parts.length !== 3) continue;
    if (parts[0] !== "editor") continue;

    const fileTimestampMs = Number(parts[2]);
    if (Number.isNaN(fileTimestampMs)) continue;

    const oneDay = 1_000 * 60 * 60 * 24;
    if (fileTimestampMs + oneDay < Date.now()) {
      tryCatch(() => fsDeps.unlinkSync(fullPath));
    }
  }
}

export type EditorLog = typeof editorLog;

export function initLogs() {
  resetDebugLog();
  deleteExpiredEditorLogs();
  initEditorLog();
}
