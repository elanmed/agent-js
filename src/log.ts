import { basename, dirname, extname, join } from "node:path";
import { actions, getState } from "./state.ts";
import { normalizeLine, tryCatch } from "./utils.ts";
import crypto from "node:crypto";
import { fsDeps } from "./deps.ts";
import { getDebugLogPath, getPromptHistoryDir } from "./paths.ts";

export function debugLog(content: string) {
  if (!getState().app.debugLog) return;

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

export function appendToPromptHistory(content: string) {
  const path = getState().app.promptHistoryPath;
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

export function initPromptHistory() {
  const promptHistoryDir = getPromptHistoryDir();
  if (!fsDeps.existsSync(promptHistoryDir)) {
    const mkDirResult = tryCatch(() =>
      fsDeps.mkdirSync(promptHistoryDir, { recursive: true }),
    );
    if (!mkDirResult.ok) return;
  }

  const uuid = crypto.randomUUID().replaceAll("-", "");
  const promptHistorySessionPath = join(
    promptHistoryDir,
    `prompt-history-${uuid}-${Date.now().toString()}.log`,
  );
  actions.setPromptHistoryPath(promptHistorySessionPath);
  tryCatch(() => fsDeps.writeFileSync(promptHistorySessionPath, ""));
}

export function deleteExpiredPromptHistory() {
  const promptHistoryPath = getPromptHistoryDir();
  if (!fsDeps.existsSync(promptHistoryPath)) return;

  for (const name of fsDeps.readdirSync(promptHistoryPath)) {
    const fullPath = join(promptHistoryPath, name);
    const statResult = tryCatch(() => fsDeps.statSync(fullPath));
    if (!statResult.ok) continue;
    if (!statResult.value.isFile()) continue;

    const fileName = basename(name, extname(name));
    const parts = fileName.split("-");
    if (parts.length !== 4) continue;
    if (parts[0] !== "prompt" || parts[1] !== "history") continue;

    const fileTimestampMs = Number(parts[3]);
    if (Number.isNaN(fileTimestampMs)) continue;

    const oneDay = 1_000 * 60 * 60 * 24;
    if (fileTimestampMs + oneDay < Date.now()) {
      tryCatch(() => fsDeps.unlinkSync(fullPath));
    }
  }
}

export function initLogs() {
  resetDebugLog();
  deleteExpiredPromptHistory();
  initPromptHistory();
}
