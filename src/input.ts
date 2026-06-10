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
  getTempFileName,
  execPromise,
  isExisty,
} from "./utils.ts";
import {
  print,
  printNewline,
  fencePrint,
  calculateSessionUsage,
} from "./print.ts";
import { basename, extname, join } from "node:path";
import { actions, getState, type SlashCommand } from "./state.ts";
import childProcess from "node:child_process";
import os from "node:os";
import type { Key } from "./config.ts";
import { appendToChatHistory } from "./log.ts";
import { fsDeps, processDeps } from "./deps.ts";
import { getGlobalSlashCommandDir, getLocalSlashCommandDir } from "./paths.ts";
import { contextFileSkillNamePrefix } from "./context.ts";

// https://stackoverflow.com/a/33500118
const mutedStdout = new Writable({
  write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (getState().app.spinnerTimeout === null) {
      stdout.write(chunk);
    }
    callback();
  },
});

Object.defineProperties(mutedStdout, {
  columns: {
    get: () => stdout.columns,
    enumerable: true,
    configurable: true,
  },
  rows: {
    get: () => stdout.rows,
    enumerable: true,
    configurable: true,
  },
});

export function initReadline() {
  const rl = readline.createInterface({
    input: stdin,
    output: mutedStdout,
    terminal: true,
  });
  actions.setRl(rl);

  if (stdin.isTTY) {
    stdin.setRawMode(true);
  }

  if (stdout.isTTY) {
    stdout.on("resize", () => {
      mutedStdout.emit("resize");
    });
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
  const rl = getState().app.rl;
  assert(rl !== null);

  const prefilledEditorContent = (() => {
    const editorInputValue = getState().app.editorInputValue;
    if (editorInputValue !== null) {
      return `${normalizeLine(editorInputValue)}\n`;
    }

    return "";
  })();

  const readlineContent = (() => {
    if (rl.line.length) {
      return rl.line;
    }

    return "";
  })();

  let clipboardContent = "";
  if (opts.includeClipboardSuffix) {
    const defaultPasteCmd = (() => {
      if (os.platform() === "darwin") {
        return "pbpaste";
      }

      if (os.platform() === "linux") {
        return "xclip -selection clipboard -o";
      }

      return "";
    })();

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
  actions.setEditorInputValue(editorContent);
  const questionAbortController = getState().abortControllers.question;
  if (questionAbortController) {
    const rl = clearRlLine()!;

    const newlineIdx = editorContent.indexOf("\n");

    const firstLine = (() => {
      if (newlineIdx === -1) return editorContent;
      return editorContent.substring(0, newlineIdx);
    })();

    const truncatedFirstLine = (() => {
      if (newlineIdx === -1) {
        return firstLine.substring(0, 50);
      }
      return firstLine.substring(0, 50).concat("…");
    })();

    rl.write(truncatedFirstLine);
    actions.appendToStdout(truncatedFirstLine);

    questionAbortController.abort();
  }
}

export function initKeypress() {
  const rl = getState().app.rl;
  assert(rl !== null);
  stdin.on("keypress", (_char, key: Key) => {
    void (async () => {
      if (isSameKey(key, getState().config.keymapEditPrompt)) {
        const editorContent = await spawnAndReadEditorContent();
        if (editorContent !== null) {
          abortRlQuestionForEditor(editorContent);
        }
        return;
      }

      if (isSameKey(key, getState().config.keymapClear)) {
        if (getState().abortControllers.question === null) return;

        rl.write("/clear\n");
        actions.appendToStdout("/clear\n");
        return;
      }

      if (isSameKey(key, getState().config.keymapEditPastePrompt)) {
        const editorContent = await spawnAndReadEditorContent({
          includeClipboardSuffix: true,
        });
        if (editorContent !== null) {
          abortRlQuestionForEditor(editorContent);
        }
        return;
      }

      if (isSameKey(key, getState().config.keymapChatHistory)) {
        chatHistoryCommand();
        return;
      }

      if (getState().app.spinnerTimeout !== null) {
        rl.write(null, { ctrl: true, name: "u" });
      }
    })();
  });
}

export function initSigInt() {
  const rl = getState().app.rl;
  assert(rl !== null);
  rl.on("SIGINT", () => {
    const apiStream = getState().abortControllers.apiStream;
    if (apiStream) {
      apiStream.abort();
      return;
    }

    const question = getState().abortControllers.question;
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
  const rl = getState().app.rl;
  assert(rl !== null);

  if (getState().app.editorInputValue !== null) {
    const editorInputValue = getState().app.editorInputValue!;
    appendToChatHistory(editorInputValue);
    actions.setEditorInputValue(null);
    return editorInputValue;
  }

  if (!isFirstInput) {
    printNewline();
  }
  fencePrint("Input", { color: "yellow" });
  actions.resetStdout();

  actions.setQuestionAbortController(new AbortController());
  const inputResult = await tryCatchAsync(
    rl.question("> ", {
      signal: getState().abortControllers.question!.signal,
    }),
  );
  actions.setQuestionAbortController(null);

  if (!inputResult.ok) {
    if (!isAbortError(inputResult.error)) {
      actions.appendToStdout(`>[unable to read rl.question result]\n`);
      print.error(getMessageFromError(inputResult.error));
      return null;
    }

    const abortedByEditor = getState().app.editorInputValue !== null;
    if (abortedByEditor) {
      const editorInputValue = getState().app.editorInputValue!;
      appendToChatHistory(editorInputValue);
      actions.setEditorInputValue(null);
      return editorInputValue;
    }

    await resolveExitConfirmation();
    return null;
  }

  actions.appendToStdout(`>${inputResult.value}\n`);
  appendToChatHistory(inputResult.value);
  const rawInput = inputResult.value.trim();

  if (getState().app.editorInputValue === null && rawInput.at(0) === "/") {
    return await resolveSlashCommand(rawInput);
  }

  return rawInput;
}

async function resolveExitConfirmation() {
  const rl = getState().app.rl;
  assert(rl !== null);

  actions.setQuestionAbortController(new AbortController());
  const exitResult = await tryCatchAsync(
    rl.question("y(es) or <C-c> to exit: ", {
      signal: getState().abortControllers.question!.signal,
    }),
  );
  actions.setQuestionAbortController(null);

  if (!exitResult.ok) {
    if (isAbortError(exitResult.error)) {
      rl.close();
      process.exit(0);
    }

    print.error(getMessageFromError(exitResult.error));
    return;
  }

  if (/^y(es)?$/i.exec(exitResult.value)) {
    actions.appendToStdout(`>${exitResult.value}\n`);

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

  switch (commandWithoutSlash) {
    case "edit": {
      return await spawnAndReadEditorContent();
    }
    case "paste": {
      return await spawnAndReadEditorContent({
        includeClipboardSuffix: true,
      });
    }
    case "clear": {
      clearCommand();
      return null;
    }
    case "history": {
      chatHistoryCommand();
      return null;
    }
    case "model": {
      getModelCommand();
      return null;
    }
    case "skills": {
      printSkillsCommand();
      return null;
    }
    case "context": {
      printContextFilesCommand();
      return null;
    }
    case "commands": {
      printCommandsCommand();
      return null;
    }
    case "keymaps": {
      printKeymapsCommand();
      return null;
    }
    default: {
      if (commandWithoutSlash.startsWith("model ")) {
        setModelCommand(rawInput);
        return null;
      }

      const slashCommands = getState().app.slashCommands;
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
  }
}

export function clearCommand() {
  print.infoSubtle(`Context cleared (${calculateSessionUsage()})`);
  actions.resetMessageUsages();
  actions.resetMessageParams();
}

export async function spawnAndReadEditorContent(opts?: {
  includeClipboardSuffix?: boolean;
}) {
  const includeClipboardSuffix = opts?.includeClipboardSuffix ?? false;

  const initialContent = await getEditorInitialContent({
    includeClipboardSuffix,
  });
  const tempFile = getTempFileName();

  const editCommand = (() => {
    if (isExisty(processDeps.env.get("AGENT_JS_EDIT"))) {
      return processDeps.env
        .get("AGENT_JS_EDIT")!
        .replace("__FILE__", tempFile);
    }

    if (isExisty(processDeps.env.get("EDITOR"))) {
      return `${processDeps.env.get("EDITOR")!} ${tempFile}`;
    }

    return `vi ${tempFile}`;
  })();

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

  return normalizeLine(readResult.value);
}

export function chatHistoryCommand() {
  const logPath = getState().app.chatHistoryPath;
  const logContentResult = tryCatch(() =>
    fsDeps.readFileSync(logPath).toString(),
  );
  if (!logContentResult.ok) {
    print.warning("[Cannot read history]");
    clearRlLine()!.prompt();
    return;
  }

  const editCommand = (() => {
    if (isExisty(processDeps.env.get("AGENT_JS_HISTORY"))) {
      return processDeps.env
        .get("AGENT_JS_HISTORY")!
        .replace("__FILE__", logPath);
    }

    if (isExisty(processDeps.env.get("EDITOR"))) {
      return `${processDeps.env.get("EDITOR")!} "${logPath}"`;
    }

    return `vi "${logPath}"`;
  })();

  childProcess.spawnSync(editCommand, {
    shell: true,
    stdio: "inherit",
  });

  tryCatch(() => fsDeps.writeFileSync(logPath, logContentResult.value));
}

export function getModelCommand() {
  print.doing(getState().config.model);
  return;
}

export function setModelCommand(rawInput: string) {
  const parts = rawInput.trim().split(/\s+/);

  if (parts.length !== 2) {
    print.error("Usage: /model [model]?");
    return;
  }
  const model = parts[1];
  assert(model !== undefined);

  const prevModel = getState().config.model;
  actions.setModel(model);
  print.doing(`Model updated from \`${prevModel}\` to \`${model}\``);
}

export function printSkillsCommand() {
  if (getState().app.skills.length === 0) {
    printNewline();
    print.doing("No available skills");
    return;
  }

  const skillsList = getState()
    .app.skills.filter(
      (skill) => !skill.name.startsWith(contextFileSkillNamePrefix),
    )
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
  if (getState().app.contextEntries.length === 0) {
    printNewline();
    print.doing("No available context files");
    return;
  }

  const contextFiles = getState().app.contextEntries.map(
    (context) => `- ${context.filePath}`,
  );

  const contextSkillFiles = getState()
    .app.skills.filter((skill) =>
      skill.name.startsWith(contextFileSkillNamePrefix),
    )
    .map((skill) => `- ${join(skill.dir, "AGENTS.md")} (as a skill)`);

  const formatted = contextFiles.concat(contextSkillFiles).join("\n");

  printNewline();
  print.doing("Available context files:");
  print(formatted);
}

function getCommandsStr() {
  const customCommandsFormatted = getState().app.slashCommands.map(
    (command) => `- ${command.filePath}`,
  );

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
  print(`- edit: ${JSON.stringify(getState().config.keymapEditPrompt)}`);
  print(`- history: ${JSON.stringify(getState().config.keymapChatHistory)}`);
  print(`- paste: ${JSON.stringify(getState().config.keymapEditPastePrompt)}`);
  print(`- clear: ${JSON.stringify(getState().config.keymapClear)}`);
}

export function clearRlLine(): readline.Interface | null {
  const rl = getState().app.rl;
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
    ...getState().app.customSlashCommandDirs,
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
