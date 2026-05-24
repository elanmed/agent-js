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
  execPromise,
} from "./utils.ts";
import {
  print,
  printNewline,
  fencePrint,
  calculateSessionUsage,
} from "./print.ts";
import { basename, extname, join } from "node:path";
import { actions, dispatch, selectors, type SlashCommand } from "./state.ts";
import childProcess from "node:child_process";
import os from "node:os";
import type { Key } from "./config.ts";
import { editorLog } from "./log.ts";
import { childProcessDeps, fsDeps, processDeps } from "./deps.ts";
import { getGlobalSlashCommandDir, getLocalSlashCommandDir } from "./paths.ts";

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

async function getEditorInitialContent(opts: {
  includeClipboardSuffix: boolean;
}) {
  const rl = selectors.getRl();
  assert(rl !== null);

  let prefilledEditorContent = "";
  const editorInputValue = selectors.getEditorInputValue();
  if (editorInputValue !== null) {
    prefilledEditorContent = `${normalizeLine(editorInputValue)}\n`;
  }

  let readlineContent = "";
  if (rl.line.length) {
    readlineContent = rl.line;
  }

  let clipboardContent = "";
  if (opts.includeClipboardSuffix) {
    let defaultPasteCmd = "";
    if (os.platform() === "darwin") {
      defaultPasteCmd = "pbpaste";
    } else if (os.platform() === "linux") {
      defaultPasteCmd = "xclip -selection clipboard -o";
    }

    const pasteCmd =
      processDeps.env.get("AGENT_JS_CLIPBOARD_PASTE") ?? defaultPasteCmd;

    const pasteResult = await tryCatchAsync(execPromise(pasteCmd));
    if (pasteResult.ok) {
      clipboardContent = normalizeLine(pasteResult.value.stdout);
    }
  }

  return `${prefilledEditorContent}${readlineContent}${clipboardContent}`;
}

function abortRlQuestionForEditor(editorContent: string) {
  dispatch(actions.setEditorInputValue(editorContent));
  const questionAbortController = selectors.getQuestionAbortController();
  if (questionAbortController) {
    const rl = clearRlLine()!;
    rl.write("[editor]");
    dispatch(actions.appendToStdout("[editor]"));

    questionAbortController.abort();
  }
}

export function initKeypress() {
  const rl = selectors.getRl();
  assert(rl !== null);
  stdin.on("keypress", async (_char, key: Key) => {
    if (isSameKey(key, selectors.getKeymapEdit())) {
      const editorContent = await spawnAndReadEditorContent();
      if (editorContent !== null) {
        abortRlQuestionForEditor(editorContent);
      }
    } else if (isSameKey(key, selectors.getKeymapClear())) {
      if (selectors.getQuestionAbortController() === null) return;

      rl.write("/clear\n");
      dispatch(actions.appendToStdout("/clear\n"));
    } else if (isSameKey(key, selectors.getKeymapEditLog())) {
      editLogCommand();
    } else if (
      isSameKey(key, { name: "v", ctrl: true }) ||
      isSameKey(key, { name: "v", meta: true })
    ) {
      const editorContent = await spawnAndReadEditorContent({
        includeClipboardSuffix: true,
      });
      if (editorContent !== null) {
        abortRlQuestionForEditor(editorContent);
      }
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

    const question = selectors.getQuestionAbortController();
    if (question) {
      if (rl.line.length > 0) {
        clearRlLine();
        return;
      }
      question.abort();
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
  fencePrint("Input", { color: "yellow" });
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
      print.error(getMessageFromError(inputResult.error));
      return null;
    }

    const abortedByEditor = selectors.getEditorInputValue() !== null;
    if (abortedByEditor) {
      dispatch(actions.appendToStdout(`>[editor]\n`));
      const editorInputValue = selectors.getEditorInputValue()!;
      dispatch(actions.setEditorInputValue(null));
      return editorInputValue;
    }

    await resolveExitConfirmation();
    return null;
  }

  dispatch(actions.appendToStdout(`>${inputResult.value}\n`));
  const rawInput = inputResult.value.trim();

  if (selectors.getEditorInputValue() === null && rawInput.at(0) === "/") {
    return await resolveSlashCommand(rawInput);
  }

  return rawInput;
}

async function resolveExitConfirmation() {
  const rl = selectors.getRl();
  assert(rl !== null);

  dispatch(actions.setQuestionAbortController(new AbortController()));
  const exitResult = await tryCatchAsync(
    rl.question("y(es) or <C-c> to exit: ", {
      signal: selectors.getQuestionAbortController()!.signal,
    }),
  );
  dispatch(actions.setQuestionAbortController(null));

  if (!exitResult.ok) {
    if (isAbortError(exitResult.error)) {
      rl.close();
      process.exit(0);
    }

    print.error(getMessageFromError(exitResult.error));
    return;
  }

  if (/^y(es)?$/i.exec(exitResult.value)) {
    dispatch(actions.appendToStdout(`>${exitResult.value}\n`));

    rl.close();
    process.exit(0);
  }

  return;
}

const builtinSlashCommands = ["edit", "edit-log", "clear", "model", "skills"];

export async function resolveSlashCommand(rawInput: string) {
  const commandWithoutSlash = rawInput.slice(1);
  if (commandWithoutSlash === "edit") {
    return await spawnAndReadEditorContent();
  } else if (commandWithoutSlash === "clear") {
    clearCommand();
    return null;
  } else if (commandWithoutSlash === "edit-log") {
    editLogCommand();
    return null;
  } else if (commandWithoutSlash.startsWith("model")) {
    setModelCommand(rawInput);
    return null;
  } else if (commandWithoutSlash === "skills") {
    printSkillsCommand();
    return null;
  } else if (commandWithoutSlash === "context") {
    printContextFilesCommand();
    return null;
  } else if (commandWithoutSlash === "commands") {
    printCommandsCommand();
    return null;
  }

  const slashCommands = selectors.getSlashCommands();
  const matchedCommand = slashCommands.find(
    (command) => command.name === commandWithoutSlash,
  );
  if (matchedCommand !== undefined) {
    print.infoSubtle(`Executing slash command: ${rawInput}`);
    return matchedCommand.content;
  }

  print.error(
    `Invalid / command detected, valid commands: ${slashCommands
      .map((c) => c.name)
      .concat(builtinSlashCommands)
      .join(", ")}`,
  );
  return null;
}

export function clearCommand() {
  print.infoSubtle(`Context cleared (${calculateSessionUsage()})`);
  dispatch(actions.resetMessageUsages());
  dispatch(actions.resetMessageParams());
}

export async function spawnAndReadEditorContent(opts?: {
  includeClipboardSuffix?: boolean;
}) {
  const includeClipboardSuffix = opts?.includeClipboardSuffix ?? false;

  const initialContent = await getEditorInitialContent({
    includeClipboardSuffix,
  });
  const tempFile = createTempFile();
  const editor =
    processDeps.env.get("AGENT_JS_EDITOR") ??
    processDeps.env.get("EDITOR") ??
    "vi";

  const writeResult = tryCatch(() =>
    fsDeps.writeFileSync(tempFile, initialContent),
  );
  if (!writeResult.ok) {
    print.error("Failed to write to temp file");
    return null;
  }
  childProcess.spawnSync(`${editor} ${tempFile}`, {
    shell: true,
    stdio: "inherit",
  });

  const readResult = tryCatch(() => fsDeps.readFileSync(tempFile).toString());
  if (!readResult.ok) {
    print.error("Failed to read from temp file");
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
      print.warning("[Edit log does not exist]");
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
    print.error("Usage: /model [model]");
    return;
  }
  const model = parts[1];
  assert(model !== undefined);

  const prevModel = selectors.getModel();
  dispatch(actions.setModel(model));
  print.doing(`Model updated from ${prevModel} to ${model}`);
}

export function printSkillsCommand() {
  const skillsList = selectors
    .getSkills()
    .map(
      (skill) => `- ${skill.name}: ${skill.description}
  ${join(skill.dir, "SKILL.md")}`,
    )
    .join("\n");

  printNewline();
  print.doing("Available skills:");
  print(skillsList);
}

export function printContextFilesCommand() {
  const contextFilesFormatted = selectors
    .getContextEntries()
    .map((context) => `- ${context.filePath}`)
    .join("\n");

  printNewline();
  print.doing("Available context files:");
  print(contextFilesFormatted);
}

export function printCommandsCommand() {
  const customCommandsFormatted = selectors
    .getSlashCommands()
    .map((command) => `- ${command.filePath}`);

  const builtinCommandsFormatted = builtinSlashCommands.map(
    (command) => `- ${command}`,
  );

  const commandsFormatted = builtinCommandsFormatted
    .concat(customCommandsFormatted)
    .join("\n");

  printNewline();
  print.doing("Available /commands:");
  print(commandsFormatted);
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

  const slashCommandDirs = [
    ...selectors.getCustomSlashCommandDirs(),
    getLocalSlashCommandDir(),
    getGlobalSlashCommandDir(),
  ];

  for (const dir of slashCommandDirs) {
    const glob = join(dir, "**/*.md");
    const globResult = tryCatch(() => fsDeps.globSync(glob));
    if (!globResult.ok) continue;
    slashCommandFilePaths.push(...globResult.value);
  }

  for (const filePath of slashCommandFilePaths) {
    const readResult = tryCatch(() => fsDeps.readFileSync(filePath).toString());
    if (!readResult.ok) continue;
    const name = basename(filePath, extname(filePath));
    if (seenSlashCommands.has(name)) continue;
    seenSlashCommands.add(name);

    entries.push({ filePath, name, content: readResult.value });
  }

  return entries;
}
