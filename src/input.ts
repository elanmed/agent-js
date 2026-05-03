import readline from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import assert from "node:assert";
import {
  isAbortError,
  tryCatch,
  tryCatchAsync,
  getMessageFromError,
  colorPrint,
  normalizeLine,
  isSameKey,
  printNewline,
  fencePrint,
  createTempFile,
  clearRlLine,
  calculateSessionUsage,
} from "./utils.ts";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
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
    if (isSameKey(key, selectors.getKeymapEdit())) {
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
          const rl = clearRlLine()!;
          rl.write("[editor]");
          dispatch(actions.appendToStdout("[editor]"));

          questionAbortController.abort();
        }
      }
    } else if (isSameKey(key, selectors.getKeymapClear())) {
      if (selectors.getQuestionAbortController() === null) return;
      rl.write("/clear\n");
      dispatch(actions.appendToStdout("/clear\n"));
    } else if (isSameKey(key, selectors.getKeymapEditLog())) {
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
        clearRlLine();
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

  printNewline();
  fencePrint("Input", { color: "yellow", skipSessionUsage: true });
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
      colorPrint(getMessageFromError(inputResult.error), "red");
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
    colorPrint(`Executing slash command: ${rawInput}`, "grey");
    const path = join(
      process.cwd(),
      ".agent-js",
      "commands",
      rawInput.slice(1).concat(".md"),
    );
    debugLog(`Performing the slash command at ${path}`);
    const commandResult = tryCatch(() => readFileSync(path).toString());
    if (commandResult.ok) return commandResult.value;

    colorPrint(`Error reading the slash command located at ${path}`, "red");
    return null;
  }

  colorPrint(
    `Invalid / command detected, valid commands: ${selectors.getSlashCommands().concat(["edit", "edit-log", "clear"]).join(",")}`,
    "red",
  );
  return null;
}

export function clearCommand() {
  debugLog("Performing the `clear` slash command");
  colorPrint(`Context cleared (${calculateSessionUsage()})`, "grey");
  dispatch(actions.resetMessageUsages());
  dispatch(actions.resetMessageParams());
}

export function editCommand(currentLine: string) {
  const tempFile = createTempFile();
  const editor =
    process.env["AGENT_JS_EDITOR"] ?? process.env["EDITOR"] ?? "vi";
  const writeResult = tryCatch(() => writeFileSync(tempFile, currentLine));
  if (!writeResult.ok) {
    colorPrint("Failed to write to temp file", "red");
    return "";
  }
  spawnSync(`${editor} "${tempFile}"`, { shell: true, stdio: "inherit" });

  const readResult = tryCatch(() => readFileSync(tempFile).toString());
  if (!readResult.ok) {
    colorPrint("Failed to read from temp file", "red");
    tryCatch(() => unlinkSync(tempFile));
    return "";
  }
  const content = normalizeLine(readResult.value);
  tryCatch(() => unlinkSync(tempFile));

  editorLog(content);

  return content;
}

export function editLogCommand() {
  if (!existsSync(EDITOR_LOG_PATH)) {
    colorPrint("[Edit log does not exist]", "yellow");
    clearRlLine()!.prompt();
    return;
  }
  const editor =
    process.env["AGENT_JS_EDITOR_LOG"] ?? process.env["EDITOR"] ?? "vi";

  spawnSync(`${editor} "${EDITOR_LOG_PATH}"`, {
    shell: true,
    stdio: "inherit",
  });
}
