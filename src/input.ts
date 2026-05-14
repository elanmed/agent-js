import readline from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import assert from "node:assert";
import { Writable } from "node:stream";
import {
  isAbortError,
  tryCatch,
  tryCatchAsync,
  getMessageFromError,
  normalizeLine,
  createTempFile,
} from "./utils.ts";
import {
  colorPrint,
  printNewline,
  fencePrint,
  calculateSessionUsage,
} from "./print.ts";
import { basename, join } from "node:path";
import { actions, dispatch, selectors, type SlashCommand } from "./state.ts";
import childProcess from "node:child_process";
import type { Key } from "./config.ts";
import { debugLog, editorLog } from "./log.ts";
import { fsDeps, processDeps } from "./deps.ts";
import { getGlobalCommandsDir, getLocalCommandsDir } from "./paths.ts";

// https://stackoverflow.com/a/33500118
const mutedStdout = new Writable({
  write(chunk: Buffer, _encoding: string, callback: () => void) {
    if (selectors.getSpinnerTimeout() === null) {
      stdout.write(chunk);
    }
    callback();
  },
});

export function initReadline() {
  const rl = readline.createInterface({
    input: stdin,
    output: mutedStdout,
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
    } else if (selectors.getSpinnerTimeout() !== null) {
      rl.write(null, { ctrl: true, name: "u" });
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
      return;
    }

    const toolCall = selectors.getToolCallAbortController();
    if (toolCall) {
      toolCall.abort();
      return;
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

// NOTE: missing test coverage
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

export function resolveSlashCommand(rawInput: string) {
  const commandWithoutSlash = rawInput.trim().slice(1);
  if (commandWithoutSlash === "edit") {
    return editCommand("");
  } else if (commandWithoutSlash === "clear") {
    clearCommand();
    return null;
  } else if (commandWithoutSlash === "edit-log") {
    editLogCommand();
    return null;
  } else if (commandWithoutSlash.startsWith("model")) {
    setModelCommand(rawInput);
    return null;
  }

  const slashCommands = selectors.getSlashCommands();
  const matchedCommand = slashCommands.find(
    (command) => command.name === commandWithoutSlash,
  );
  if (matchedCommand !== undefined) {
    colorPrint(`Executing slash command: ${rawInput}`, "grey");
    debugLog(`Performing the slash command at ${matchedCommand.filePath}`);
    return matchedCommand.content;
  }

  colorPrint(
    `Invalid / command detected, valid commands: ${slashCommands
      .map((c) => c.name)
      .concat(["edit", "edit-log", "clear", "model"])
      .join(",")}`,
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
    processDeps.env.get("AGENT_JS_EDITOR") ??
    processDeps.env.get("EDITOR") ??
    "vi";
  const writeResult = tryCatch(() =>
    fsDeps.writeFileSync(tempFile, currentLine),
  );
  if (!writeResult.ok) {
    colorPrint("Failed to write to temp file", "red");
    return null;
  }
  childProcess.spawnSync(`${editor} "${tempFile}"`, {
    shell: true,
    stdio: "inherit",
  });

  const readResult = tryCatch(() => fsDeps.readFileSync(tempFile).toString());
  if (!readResult.ok) {
    colorPrint("Failed to read from temp file", "red");
    tryCatch(() => fsDeps.unlinkSync(tempFile));
    return null;
  }
  tryCatch(() => fsDeps.unlinkSync(tempFile));

  if (readResult.value === "") return null;

  const content = normalizeLine(readResult.value);
  editorLog(content);
  return content;
}

export function editLogCommand() {
  if (!fsDeps.existsSync(selectors.getEditorLogPath())) {
    if (selectors.getSpinnerTimeout() === null) {
      colorPrint("[Edit log does not exist]", "yellow");
      clearRlLine()!.prompt();
    }
    return;
  }
  const editor =
    processDeps.env.get("AGENT_JS_EDITOR_LOG") ??
    processDeps.env.get("EDITOR") ??
    "vi";

  childProcess.spawnSync(`${editor} "${selectors.getEditorLogPath()}"`, {
    shell: true,
    stdio: "inherit",
  });
}

export function setModelCommand(rawInput: string) {
  const parts = rawInput.trim().split(" ");
  if (parts.length !== 2) {
    colorPrint("Usage: /model [model]", "red");
    return;
  }
  const model = parts[1];
  assert(model !== undefined);

  const prevModel = selectors.getModel();
  dispatch(actions.setModel(model));
  colorPrint(`Model updated from ${prevModel} to ${model}`, "blue");
}

export function isSameKey(a: Key, b: Key) {
  return (
    a.name === b.name &&
    (a.ctrl ?? false) === (b.ctrl ?? false) &&
    (a.meta ?? false) === (b.meta ?? false) &&
    (a.shift ?? false) === (b.shift ?? false)
  );
}

export function clearRlLine(): readline.Interface | null {
  const rl = selectors.getRl();
  assert(rl !== null);
  rl.write(null, { ctrl: true, name: "e" });
  rl.write(null, { ctrl: true, name: "u" });
  return rl;
}

export function getAvailableSlashCommands() {
  const seenSlashCommands = new Set<string>();

  const entries: SlashCommand[] = [];
  const slashCommandFilePaths: string[] = [];

  const slashCommandDirs = [getLocalCommandsDir(), getGlobalCommandsDir()];

  for (const dir of slashCommandDirs) {
    const glob = join(dir, "**/*.md");
    const globResult = tryCatch(() => fsDeps.globSync(glob));
    if (!globResult.ok) continue;
    slashCommandFilePaths.push(...globResult.value);
  }

  for (const filePath of slashCommandFilePaths) {
    const readResult = tryCatch(() => fsDeps.readFileSync(filePath).toString());
    if (!readResult.ok) continue;
    const name = basename(filePath);
    if (seenSlashCommands.has(name)) continue;
    seenSlashCommands.add(name);

    entries.push({ filePath, name, content: readResult.value });
  }

  return entries;
}
