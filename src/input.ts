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
  isExisty,
  compute,
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
import { appendToPromptHistory } from "./log.ts";
import { fsDeps, processDeps } from "./deps.ts";
import { getGlobalSlashCommandDir, getLocalSlashCommandDir } from "./paths.ts";
import { contextFileSkillNamePrefix } from "./context.ts";

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

  const prefilledEditorContent = compute(() => {
    const editorInputValue = selectors.getEditorInputValue();
    if (editorInputValue !== null) {
      return `${normalizeLine(editorInputValue)}\n`;
    }

    return "";
  });

  const readlineContent = compute(() => {
    if (rl.line.length) {
      return rl.line;
    }

    return "";
  });

  let clipboardContent = "";
  if (opts.includeClipboardSuffix) {
    const defaultPasteCmd = compute(() => {
      if (os.platform() === "darwin") {
        return "pbpaste";
      }

      if (os.platform() === "linux") {
        return "xclip -selection clipboard -o";
      }

      return "";
    });

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

    const newlineIdx = editorContent.indexOf("\n");

    const firstLine = compute(() => {
      if (newlineIdx === -1) return editorContent;
      return editorContent.substring(0, newlineIdx);
    });

    const truncatedFirstLine = compute(() => {
      if (newlineIdx === -1) {
        return firstLine.substring(0, 50);
      }
      return firstLine.substring(0, 50).concat("…");
    });

    rl.write(truncatedFirstLine);
    dispatch(actions.appendToStdout(truncatedFirstLine));

    questionAbortController.abort();
  }
}

export function initKeypress() {
  const rl = selectors.getRl();
  assert(rl !== null);
  stdin.on("keypress", (_char, key: Key) => {
    void (async () => {
      if (isSameKey(key, selectors.getKeymapEditPrompt())) {
        const editorContent = await spawnAndReadEditorContent();
        if (editorContent !== null) {
          abortRlQuestionForEditor(editorContent);
        }
        return;
      }

      if (isSameKey(key, selectors.getKeymapClear())) {
        if (selectors.getQuestionAbortController() === null) return;

        rl.write("/clear\n");
        dispatch(actions.appendToStdout("/clear\n"));
        return;
      }

      if (isSameKey(key, selectors.getKeymapEditPastePrompt())) {
        const editorContent = await spawnAndReadEditorContent({
          includeClipboardSuffix: true,
        });
        if (editorContent !== null) {
          abortRlQuestionForEditor(editorContent);
        }
        return;
      }

      if (isSameKey(key, selectors.getKeymapPromptHistory())) {
        promptHistoryCommand();
        return;
      }

      if (selectors.getSpinnerTimeout() !== null) {
        rl.write(null, { ctrl: true, name: "u" });
      }
    })();
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

export async function resolveUserInput({
  isFirstInput,
}: {
  isFirstInput: boolean;
}) {
  const rl = selectors.getRl();
  assert(rl !== null);

  if (selectors.getEditorInputValue() !== null) {
    const editorInputValue = selectors.getEditorInputValue()!;
    dispatch(actions.setEditorInputValue(null));
    return editorInputValue;
  }

  if (!isFirstInput) {
    printNewline();
  }
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

  appendToPromptHistory(inputResult.value);
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

const builtinSlashCommands = [
  "edit",
  "history",
  "clear",
  "model",
  "skills",
  "context",
  "commands",
  "keymaps",
];

export async function resolveSlashCommand(rawInput: string) {
  const commandWithoutSlash = rawInput.slice(1);
  if (commandWithoutSlash === "edit") {
    return await spawnAndReadEditorContent();
  }

  if (commandWithoutSlash === "clear") {
    clearCommand();
    return null;
  }

  if (commandWithoutSlash === "history") {
    promptHistoryCommand();
    return null;
  }

  if (commandWithoutSlash.startsWith("model ")) {
    setModelCommand(rawInput);
    return null;
  }

  if (commandWithoutSlash === "skills") {
    printSkillsCommand();
    return null;
  }

  if (commandWithoutSlash === "context") {
    printContextFilesCommand();
    return null;
  }

  if (commandWithoutSlash === "commands") {
    printCommandsCommand();
    return null;
  }

  if (commandWithoutSlash === "keymaps") {
    printKeymapsCommand();
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

  printNewline();
  print.error(`Invalid command: ${rawInput}, valid commands:`);
  print(getCommandsStr());
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

  const editCommand = compute(() => {
    if (isExisty(processDeps.env.get("AGENT_JS_EDIT"))) {
      return processDeps.env
        .get("AGENT_JS_EDIT")!
        .replace("__FILE__", tempFile);
    }

    if (isExisty(processDeps.env.get("EDITOR"))) {
      return `${processDeps.env.get("EDITOR")!} ${tempFile}`;
    }

    return `vi ${tempFile}`;
  });

  const writeResult = tryCatch(() =>
    fsDeps.writeFileSync(tempFile, initialContent),
  );
  if (!writeResult.ok) {
    print.error("Failed to write to temp file");
    return null;
  }
  childProcess.spawnSync(editCommand, {
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
  appendToPromptHistory(content);
  return content;
}

export function promptHistoryCommand() {
  const logPath = selectors.getPromptHistoryPath();
  const logContentResult = tryCatch(() =>
    fsDeps.readFileSync(logPath).toString(),
  );
  if (!logContentResult.ok) {
    print.warning("[Cannot read history]");
    clearRlLine()!.prompt();
    return;
  }

  const editCommand = compute(() => {
    if (isExisty(processDeps.env.get("AGENT_JS_HISTORY"))) {
      return processDeps.env
        .get("AGENT_JS_HISTORY")!
        .replace("__FILE__", logPath);
    }

    if (isExisty(processDeps.env.get("EDITOR"))) {
      return `${processDeps.env.get("EDITOR")!} "${logPath}"`;
    }

    return `vi "${logPath}"`;
  });

  childProcess.spawnSync(editCommand, {
    shell: true,
    stdio: "inherit",
  });

  tryCatch(() => fsDeps.writeFileSync(logPath, logContentResult.value));
}

export function setModelCommand(rawInput: string) {
  const parts = rawInput.trim().split(/\s+/);

  if (parts.length === 1) {
    print.doing(selectors.getModel());
    return;
  }

  if (parts.length !== 2) {
    print.error("Usage: /model [model]?");
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
    .filter((skill) => !skill.name.startsWith(contextFileSkillNamePrefix))
    .map(
      (skill) => `- ${skill.name}: ${skill.description}
  ${skill.dir}`,
    )
    .join("\n");

  printNewline();
  print.doing("Available skills:");
  print(skillsList);
}

export function printContextFilesCommand() {
  const contextFiles = selectors
    .getContextEntries()
    .map((context) => `- ${context.filePath}`);

  const contextSkillFiles = selectors
    .getSkills()
    .filter((skill) => skill.name.startsWith(contextFileSkillNamePrefix))
    .map((skill) => `- ${join(skill.dir, "AGENTS.md")} (as a skill)`);

  const formatted = contextFiles.concat(contextSkillFiles).join("\n");

  printNewline();
  print.doing("Available context files:");
  print(formatted);
}

function getCommandsStr() {
  const customCommandsFormatted = selectors
    .getSlashCommands()
    .map((command) => `- ${command.filePath}`);

  const builtinCommandsFormatted = builtinSlashCommands.map(
    (command) => `- /${command}`,
  );

  return builtinCommandsFormatted.concat(customCommandsFormatted).join("\n");
}

export function printCommandsCommand() {
  printNewline();
  print.doing("Available commands:");
  print(getCommandsStr());
}

export function isSameKey(a: Key, b: Key) {
  return (
    a.name === b.name &&
    (a.ctrl ?? false) === (b.ctrl ?? false) &&
    (a.meta ?? false) === (b.meta ?? false) &&
    (a.shift ?? false) === (b.shift ?? false)
  );
}

export function printKeymapsCommand() {
  printNewline();
  print.doing("Keymaps:");
  print(`- keymap-edit: ${JSON.stringify(selectors.getKeymapEditPrompt())}`);
  print(
    `- keymap-history: ${JSON.stringify(selectors.getKeymapPromptHistory())}`,
  );
  print(
    `- keymap-edit-paste: ${JSON.stringify(selectors.getKeymapEditPastePrompt())}`,
  );
  print(`- keymap-clear: ${JSON.stringify(selectors.getKeymapClear())}`);
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
    const globResult = tryCatch(() => fsDeps.globbySync(glob));
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
