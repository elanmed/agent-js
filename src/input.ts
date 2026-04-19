import * as readline from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import assert from "node:assert";
import {
  isAbortError,
  tryCatchAsync,
  getMessageFromError,
  colorLog,
  normalizeLine,
  isSameKey,
  logNewline,
  fenceLog,
  createTempFile,
} from "./utils.ts";
import fs from "node:fs";
import { join } from "node:path";
import { actions, dispatch, selectors } from "./state.ts";
import { spawnSync } from "node:child_process";
import type { Key } from "./config.ts";
import { debugLog, EDITOR_LOG_PATH, editorLog } from "./log.ts";

export function initReadline() {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });
  dispatch(actions.setRl(rl));

  if (stdin.isTTY) {
    stdin.setRawMode(true);
  }

  process.on("exit", () => {
    if (stdin.isTTY) {
      stdin.setRawMode(false);
    }
  });

  emitKeypressEvents(stdin, rl);
  return rl;
}

export function initKeypress() {
  const rl = selectors.getRl();
  assert(rl !== null);
  stdin.on("keypress", (_char, key: Key) => {
    if (isSameKey(key, selectors.getKeymaps().edit)) {
      let initialContentPrefix = "";
      if (selectors.getEditorInputValue() !== null) {
        initialContentPrefix = selectors.getEditorInputValue()!;
      }

      let initialContentSuffix = "";
      if (rl.line.length) {
        initialContentSuffix = rl.line;
      }

      let initialContent = initialContentSuffix;
      if (initialContentPrefix.length) {
        initialContent = `${normalizeLine(initialContentPrefix)}\n\n${initialContentSuffix}`;
      }

      const editorContent = editCommand(initialContent);
      if (editorContent) {
        dispatch(actions.setEditorInputValue(editorContent));
        const questionAbortController = selectors.getQuestionAbortController();
        if (questionAbortController) {
          rl.write(null, { ctrl: true, name: "e" });
          rl.write(null, { ctrl: true, name: "u" });
          rl.write("[editor]");
          dispatch(actions.appendToStdout("[editor]"));

          questionAbortController.abort();
        }
      }
    } else if (isSameKey(key, selectors.getKeymaps().clear)) {
      if (selectors.getQuestionAbortController() === null) return;
      rl.write("/clear\n");
      dispatch(actions.appendToStdout("/clear\n"));
    } else if (isSameKey(key, selectors.getKeymaps().editLog)) {
      editLogCommand();
    }
  });
}

export function initSigInt() {
  const rl = selectors.getRl();
  assert(rl !== null);
  rl.on("SIGINT", () => {
    const apiStream = selectors.getApiStreamAbortController();
    if (apiStream) {
      apiStream.abort();
    }

    const questionAbortController = selectors.getQuestionAbortController();
    if (questionAbortController) {
      if (rl.line.length > 0) {
        rl.write(null, { ctrl: true, name: "e" });
        rl.write(null, { ctrl: true, name: "u" });
        return;
      }
      questionAbortController.abort();
    }

    // second <C-c> during exit confirmation
    if (selectors.getInterrupted()) {
      rl.close();
      process.exit(0);
    }
  });
}

export async function resolveUserInput() {
  const rl = selectors.getRl();
  assert(rl !== null);
  if (selectors.getEditorInputValue() !== null) {
    const editorInputValue = selectors.getEditorInputValue()!;
    dispatch(actions.setEditorInputValue(null));
    return editorInputValue;
  }

  logNewline();
  fenceLog("Input", { skipSessionUsage: true });
  dispatch(actions.resetStdout());
  dispatch(actions.setQuestionAbortController(new AbortController()));
  const inputResult = await tryCatchAsync(
    rl.question("> ", {
      signal: selectors.getQuestionAbortController()!.signal,
    }),
  );
  dispatch(actions.setQuestionAbortController(null));

  if (!inputResult.ok) {
    if (!isAbortError(inputResult.error)) {
      dispatch(
        actions.appendToStdout(`>[unable to read rl.question result]\n`),
      );
      colorLog(getMessageFromError(inputResult.error), "red");
      return null;
    }

    // only aborts if there's an active questionAbortController, which is when there's a question, not when a tool call or api call is ongoing
    if (selectors.getEditorInputValue() !== null) {
      dispatch(actions.appendToStdout(`>[editor]\n`));
      const editorInputValue = selectors.getEditorInputValue()!;
      dispatch(actions.setEditorInputValue(null));
      return editorInputValue;
    }

    // TODO: little weird, will either return null or call setRunning(false)
    return await resolveExitConfirmation();
  }

  const rawInput = inputResult.value;
  dispatch(actions.appendToStdout(`>${rawInput}\n`));

  if (selectors.getEditorInputValue() === null && rawInput.at(0) === "/") {
    return resolveSlashCommand(rawInput);
  }

  dispatch(actions.setEditorInputValue(null));
  return rawInput;
}

async function resolveExitConfirmation() {
  const rl = selectors.getRl();
  assert(rl !== null);
  dispatch(actions.setInterrupted(true));
  dispatch(actions.setQuestionAbortController(new AbortController()));
  const exitQuestionAbortController = selectors.getQuestionAbortController();
  const exitResult = await tryCatchAsync(
    rl.question("y(es) or <C-c> to exit: ", {
      signal: exitQuestionAbortController!.signal,
    }),
  );
  dispatch(actions.setQuestionAbortController(null));

  if (exitResult.ok) {
    if (/^y(es)?$/i.exec(exitResult.value)) {
      dispatch(actions.appendToStdout(`>${exitResult.value}\n`));
      debugLog("User confirmed exit");
      dispatch(actions.setRunning(false));
    }
  } else {
    // second <C-c> during confirmation is already handled by SIGINT
  }

  dispatch(actions.setInterrupted(false));
  return null;
}

function resolveSlashCommand(rawInput: string) {
  const commandWithoutSlash = rawInput.slice(1).trim();
  if (commandWithoutSlash === "edit") {
    return editCommand("");
  } else if (commandWithoutSlash === "clear") {
    clearCommand();
    return null;
  } else if (commandWithoutSlash === "edit-log") {
    editLogCommand();
    return null;
  }

  if (selectors.getSlashCommands().includes(commandWithoutSlash)) {
    colorLog(`Executing slash command: ${rawInput}`, "grey");
    const path = join(
      process.cwd(),
      ".agent-js",
      "commands",
      rawInput.slice(1).concat(".md"),
    );
    debugLog(`Performing the slash command at ${path}`);
    return `Perform the instructions located at ${path}`;
  }

  colorLog(
    `Invalid / command detected, valid commands: ${selectors.getSlashCommands().join(",")}`,
    "red",
  );
  return null;
}

export function clearCommand() {
  dispatch(actions.resetMessageUsages());
  dispatch(actions.resetMessageParams());
  debugLog("Performing the `clear` slash command");
  colorLog("Context cleared", "grey");
}

export function editCommand(currentLine: string) {
  const tempFile = createTempFile();
  const editor =
    process.env["AGENT_JS_EDITOR"] ?? process.env["EDITOR"] ?? "vi";
  fs.writeFileSync(tempFile, currentLine);
  spawnSync(`${editor} "${tempFile}"`, { shell: true, stdio: "inherit" });

  // Re-enable raw mode if it was disabled by the editor
  if (stdin.isTTY) {
    stdin.setRawMode(true);
  }

  let content = fs.readFileSync(tempFile).toString();
  content = normalizeLine(content);
  fs.unlinkSync(tempFile);

  editorLog(content);

  return content;
}

export function editLogCommand() {
  if (!fs.existsSync(EDITOR_LOG_PATH)) {
    colorLog("Edit log does not exist", "yellow");
    return;
  }
  const editor =
    process.env["AGENT_JS_EDITOR_LOG"] ?? process.env["EDITOR"] ?? "vi";

  spawnSync(`${editor} "${EDITOR_LOG_PATH}"`, {
    shell: true,
    stdio: "inherit",
  });
}
