import * as readline from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { actions, dispatch, selectors } from "./state.ts";
import {
  isAbortError,
  debugLog,
  tryCatchAsync,
  getMessageFromError,
  readFromEditor,
  colorLog,
  maybePrintUsageMessage,
} from "./utils.ts";
import { join } from "node:path";

export function initReadline() {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });

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

export function initKeypress(rl: readline.Interface) {
  stdin.on("keypress", (_char, key: { ctrl?: boolean; name?: string }) => {
    debugLog(JSON.stringify(key, null, 2));
    if (key.ctrl && key.name === "e") {
      const editorContent = readFromEditor(rl.line);
      if (editorContent) {
        rl.write(null, { ctrl: true, name: "e" });
        rl.write(null, { ctrl: true, name: "u" });
        rl.write("[editor]");
        dispatch(actions.setEditorInputValue(editorContent));
        const questionAbortController = selectors.getQuestionAbortController();
        if (questionAbortController) {
          questionAbortController.abort();
        }
      }
    }
  });
}

export function initSigInt(rl: readline.Interface) {
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

export async function resolveUserInput(rl: readline.Interface) {
  dispatch(actions.setQuestionAbortController(new AbortController()));
  const questionAbortController = selectors.getQuestionAbortController();
  const inputResult = await tryCatchAsync(
    rl.question("> ", { signal: questionAbortController!.signal }),
  );
  dispatch(actions.setQuestionAbortController(null));

  const editorInputValue = selectors.getEditorInputValue();
  if (!inputResult.ok) {
    if (!isAbortError(inputResult.error)) {
      console.error(getMessageFromError(inputResult.error));
      return null;
    }

    if (editorInputValue !== null) {
      return editorInputValue;
    }

    // TODO: little weird, will either return null or call setRunning(false)
    return await resolveExitConfirmation(rl);
  }

  const rawInput = inputResult.value;

  if (editorInputValue === null && rawInput.at(0) === "/") {
    return resolveSlashCommand(rawInput);
  }

  dispatch(actions.setEditorInputValue(null));
  return rawInput;
}

async function resolveExitConfirmation(rl: readline.Interface) {
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
      debugLog("user confirmed exit");
      dispatch(actions.setRunning(false));
    }
  } else {
    // second <C-c> during confirmation is already handled by SIGINT
  }

  dispatch(actions.setInterrupted(false));
  return null;
}

function resolveSlashCommand(rawInput: string) {
  const commandWithoutSlash = rawInput.slice(1);
  if (commandWithoutSlash === "edit") {
    return readFromEditor("");
  }

  if (commandWithoutSlash === "clear") {
    dispatch(actions.resetMessageUsages());
    dispatch(actions.resetMessageParams());
    debugLog("Reset message usages and message params");
    colorLog("Context cleared", "grey");
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
  maybePrintUsageMessage();
  return null;
}
