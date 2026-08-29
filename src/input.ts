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
  truncate,
} from "./utils.ts";
import {
  print,
  printNewline,
  fencePrint,
  printSessionStartDate,
} from "./print.ts";
import { getPrettyTokenUsage, getPrettyUsage } from "./usage.ts";
import { basename, extname, join } from "node:path";
import { actions, getState, type SlashCommand } from "./state.ts";
import childProcess from "node:child_process";
import os from "node:os";
import { readConfigFile, type Key } from "./config.ts";
import { appendToChatHistory } from "./log.ts";
import { fsDeps, processDeps } from "./deps.ts";
import {
  getGlobalConfigPath,
  getGlobalSlashCommandDir,
  getLocalConfigPath,
  getLocalSlashCommandDir,
  getPromptHistoryDir,
} from "./paths.ts";
import { contextFileSkillNamePrefix } from "./context.ts";

// https://stackoverflow.com/a/33500118
const mutedStdout = new Writable({
  write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (getState().app.loadingStateTimeout === null) {
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

    const truncatedFirstLine = truncate(editorContent);
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
        await chatHistoryCommand();
        return;
      }

      if (getState().app.loadingStateTimeout !== null) {
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
    appendToChatHistory(editorInputValue, "user");
    actions.setEditorInputValue(null);
    return editorInputValue;
  }

  if (!isFirstInput) {
    await printNewline();
  }
  await fencePrint("Input", { color: "yellow" });
  actions.resetStdout();

  actions.setQuestionAbortController(new AbortController());
  const inputResult = await tryCatchAsync(
    rl.question(getState().config.promptPrefix, {
      signal: getState().abortControllers.question!.signal,
    }),
  );
  actions.setQuestionAbortController(null);

  if (!inputResult.ok) {
    if (!isAbortError(inputResult.error)) {
      await print.error(getMessageFromError(inputResult.error));
      return null;
    }

    const abortedByEditor = getState().app.editorInputValue !== null;
    if (abortedByEditor) {
      const editorInputValue = getState().app.editorInputValue!;
      appendToChatHistory(editorInputValue, "user");
      actions.setEditorInputValue(null);
      return editorInputValue;
    }

    await resolveExitConfirmation();
    return null;
  }

  actions.appendToStdout(
    `${getState().config.promptPrefix}${inputResult.value}\n`,
  );
  appendToChatHistory(inputResult.value, "user");
  const rawInput = inputResult.value.trim();

  if (rawInput.at(0) === "/") {
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
      await printSessionStartDate();
      process.exit(0);
    }

    await print.error(getMessageFromError(exitResult.error));
    return;
  }

  if (/^y(es)?$/i.exec(exitResult.value)) {
    actions.appendToStdout(
      `${getState().config.promptPrefix}${exitResult.value}\n`,
    );

    rl.close();
    await printSessionStartDate();
    process.exit(0);
  }

  return;
}

const builtinSlashCommands = [
  "edit",
  "history",
  "clear",
  "paste",
  "model",
  "skills",
  "context",
  "commands",
  "keymaps",
  "usage",
  "resume",
  "local",
  "global",
  "config",
];

export async function resolveSlashCommand(rawInput: string) {
  const commandWithoutSlash = rawInput.slice(1);

  // TODO: separate slash commands with and without args
  switch (commandWithoutSlash) {
    case "edit": {
      const content = await spawnAndReadEditorContent();
      if (content !== null) appendToChatHistory(content, "user");
      return content;
    }
    case "paste": {
      const content = await spawnAndReadEditorContent({
        includeClipboardSuffix: true,
      });
      if (content !== null) appendToChatHistory(content, "user");
      return content;
    }
    case "clear": {
      await clearCommand();
      return null;
    }
    case "history": {
      await chatHistoryCommand();
      return null;
    }
    case "model": {
      await getModelCommand();
      return null;
    }
    case "skills": {
      await printSkillsCommand();
      return null;
    }
    case "context": {
      await printContextFilesCommand();
      return null;
    }
    case "commands": {
      await printCommandsCommand();
      return null;
    }
    case "keymaps": {
      await printKeymapsCommand();
      return null;
    }
    case "usage": {
      await usageCommand();
      return null;
    }
    case "local": {
      await localCommand();
      return null;
    }
    case "global": {
      await globalCommand();
      return null;
    }
    case "config": {
      await configCommand();
      return null;
    }
    case "resume": {
      await print.error("Usage: /resume [session start date]");
      return null;
    }
    default: {
      if (commandWithoutSlash.startsWith("model ")) {
        await setModelCommand(rawInput);
        return null;
      }

      if (commandWithoutSlash.startsWith("resume ")) {
        const content = await resumeCommand(rawInput);
        if (content !== null) appendToChatHistory(content, "user");
        return content;
      }

      const slashCommands = getState().app.slashCommands;
      const matchedCommand = slashCommands.find(
        (command) => command.name === commandWithoutSlash,
      );
      if (matchedCommand !== undefined) {
        await print.infoSubtle(`Executing slash command: ${rawInput}`);
        return matchedCommand.content;
      }

      await printNewline();
      await print.error(`Invalid command: ${rawInput}, valid commands:`);
      await print(getCommandsStr());
      return null;
    }
  }
}

export async function clearCommand() {
  await print.infoSubtle(`Context cleared (${getPrettyTokenUsage()})`);
  actions.resetMessageParams();
  actions.setModelUsageForSession({});
}

export async function usageCommand() {
  await print.doing(getPrettyUsage());
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
    await print.error("Failed to write to temp file");
    return null;
  }

  const statBefore = tryCatch(() => fsDeps.statSync(tempFile));

  childProcess.spawnSync(editCommand, {
    shell: true,
    stdio: "inherit",
  });

  const statAfter = tryCatch(() => fsDeps.statSync(tempFile));

  const readResult = tryCatch(() => fsDeps.readFileSync(tempFile).toString());
  if (!readResult.ok) {
    await print.error("Failed to read from temp file");
    tryCatch(() => fsDeps.unlinkSync(tempFile));
    return null;
  }
  tryCatch(() => fsDeps.unlinkSync(tempFile));

  if (
    statBefore.ok &&
    statAfter.ok &&
    statBefore.value.mtimeMs === statAfter.value.mtimeMs
  ) {
    return null;
  }
  if (readResult.value === "") return null;

  return normalizeLine(readResult.value);
}

export async function chatHistoryCommand() {
  const logPath = getState().app.chatHistoryPath;
  const logContentResult = tryCatch(() =>
    fsDeps.readFileSync(logPath).toString(),
  );
  if (!logContentResult.ok) {
    await print.warning("[Cannot read history]");
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

export async function getModelCommand() {
  await print.doing(getState().config.model);
  return;
}

export async function setModelCommand(rawInput: string) {
  const parts = rawInput.trim().split(/\s+/);

  if (parts.length !== 2) {
    await print.error("Usage: /model [model]?");
    return;
  }
  const model = parts[1];
  assert(model !== undefined);

  const prevModel = getState().config.model;
  actions.setModel(model);
  await print.doing(`Model updated from \`${prevModel}\` to \`${model}\``);
}

export async function printSkillsCommand() {
  if (getState().app.skills.length === 0) {
    await printNewline();
    await print.doing("No available skills");
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

  await printNewline();
  await print.doing("Available skills:");
  await print(skillsList);
}

export async function printContextFilesCommand() {
  if (getState().app.contextEntries.length === 0) {
    await printNewline();
    await print.doing("No available context files");
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

  await printNewline();
  await print.doing("Available context files:");
  await print(formatted);
}

export async function resumeCommand(rawInput: string) {
  const parts = rawInput.trim().split(/\s+/);

  if (parts.length !== 2) {
    await print.error("Usage: /resume [session start date]");
    return null;
  }
  const sessionStartDate = parts[1];
  assert(sessionStartDate !== undefined);

  if (Number.isNaN(Number(sessionStartDate))) {
    await print.error("Usage: /resume [session start date]");
    return null;
  }

  const chatHistoryPath = getPromptHistoryDir();
  if (!fsDeps.existsSync(chatHistoryPath)) return null;

  for (const name of fsDeps.readdirSync(chatHistoryPath)) {
    const fullPath = join(chatHistoryPath, name);
    const statResult = tryCatch(() => fsDeps.statSync(fullPath));
    if (!statResult.ok) continue;
    if (!statResult.value.isFile()) continue;

    const fileName = basename(name, extname(name));
    const parts = fileName.split("-");
    if (parts.length !== 3) continue;
    if (parts[0] !== "chat" || parts[1] !== "history") continue;

    const fileTimestampMs = Number(parts[2]);
    if (Number.isNaN(fileTimestampMs)) continue;
    if (fileTimestampMs !== Number(sessionStartDate)) continue;

    const readResult = tryCatch(() => fsDeps.readFileSync(fullPath).toString());
    if (!readResult.ok) continue;

    actions.resetMessageParams();
    return `Continue the conversation recorded in the transcript below. Respond to this message with "Ready to continue chatting."
Transcript:
${readResult.value}
    `;
  }

  await print.error(
    `No conversation found with session start date: ${sessionStartDate}`,
  );
  return null;
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

export async function printCommandsCommand() {
  await printNewline();
  await print.doing("Available commands:");
  await print(getCommandsStr());
}

export function isSameKey(a: Key, b: Key) {
  return (
    a.name === b.name &&
    (a.ctrl ?? false) === (b.ctrl ?? false) &&
    (a.meta ?? false) === (b.meta ?? false) &&
    (a.shift ?? false) === (b.shift ?? false)
  );
}

export async function printKeymapsCommand() {
  await printNewline();
  await print.doing("Keymaps:");
  await print(`- edit: ${JSON.stringify(getState().config.keymapEditPrompt)}`);
  await print(
    `- history: ${JSON.stringify(getState().config.keymapChatHistory)}`,
  );
  await print(
    `- paste: ${JSON.stringify(getState().config.keymapEditPastePrompt)}`,
  );
  await print(`- clear: ${JSON.stringify(getState().config.keymapClear)}`);
}

function getPrettyConfig(config: object) {
  const entries = Object.entries(config);
  if (entries.length === 0) return "{}";
  return entries
    .map(([key, value]) => `- ${key}: ${JSON.stringify(value, null, 2)}`)
    .join("\n");
}

export async function localCommand() {
  await printNewline();
  await print.doing(`Local config from path: ${getLocalConfigPath()}`);
  await print(getPrettyConfig(readConfigFile(getLocalConfigPath())));
}

export async function globalCommand() {
  await printNewline();
  await print.doing(`Global config from path: ${getGlobalConfigPath()}`);
  await print(getPrettyConfig(readConfigFile(getGlobalConfigPath())));
}

export async function configCommand() {
  await printNewline();
  await print.doing("Applied config:");
  await print(getPrettyConfig(getState().config));
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
