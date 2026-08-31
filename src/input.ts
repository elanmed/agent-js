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
  listChatHistoryFiles,
  openWithPager,
  stringify,
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
import { initStateRepeatable, type Key } from "./config.ts";
import { appendToChatHistory } from "./log.ts";
import { fsDeps, processDeps } from "./deps.ts";
import {
  getGlobalConfigPath,
  getGlobalSlashCommandDir,
  getLocalConfigPath,
  getLocalSlashCommandDir,
} from "./paths.ts";
import { contextFileSkillNamePrefix } from "./context.ts";
import { execGitDiff } from "./tools.ts";

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
    if (rl.line.length > 0) {
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
  if (questionAbortController !== null) {
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

  function typeCommand(command: string) {
    assert(rl !== null);
    rl.write(`/${command}\n`);
    actions.appendToStdout(`/${command}\n`);
  }

  stdin.on("keypress", (_char, key: Key) => {
    void (async () => {
      const keymaps = getState().config.keymaps;

      for (const command of builtinSlashCommands) {
        const keymap = keymaps[command];
        if (keymap === undefined) continue;
        if (!isSameKey(key, keymap)) continue;

        switch (command) {
          case "edit": {
            const editorContent = await spawnAndReadEditorContent();
            if (editorContent !== null) {
              abortRlQuestionForEditor(editorContent);
            }
            return;
          }
          case "paste": {
            const editorContent = await spawnAndReadEditorContent({
              includeClipboardSuffix: true,
            });
            if (editorContent !== null) {
              abortRlQuestionForEditor(editorContent);
            }
            return;
          }
          case "history": {
            openWithPager({
              initialContentPath: getState().app.chatHistoryPath,
              pagerEnvKey: "AGENT_JS_PAGER_HISTORY",
            });
            return;
          }
          case "config": {
            openWithPager({
              pagerEnvKey: "AGENT_JS_PAGER_CONFIG",
              initialContentStr: getAllPrettyConfig(),
            });

            return;
          }
          case "context-str": {
            await pageContextFiles();
            return;
          }
          case "commands-str": {
            pageCommands();
            return;
          }
          case "reload": {
            await reload();
            return;
          }
          case "model":
          case "skills":
          case "context":
          case "commands":
          case "keymaps":
          case "usage":
          case "resume":
          case "clear": {
            if (getState().abortControllers.question !== null) {
              typeCommand(command);
            }
            return;
          }
          default: {
            command satisfies never;
          }
        }
      }

      for (const slashCommand of getState().app.slashCommands) {
        const keymap = keymaps[slashCommand.name];
        if (keymap === undefined) continue;
        if (!isSameKey(key, keymap)) continue;

        if (getState().abortControllers.question !== null) {
          typeCommand(slashCommand.name);
        }
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
    if (apiStream !== null) {
      apiStream.abort();
      return;
    }

    const question = getState().abortControllers.question;
    if (question !== null) {
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

  if (/^y(es)?$/i.exec(exitResult.value) !== null) {
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
  "context-str",
  "commands",
  "commands-str",
  "keymaps",
  "usage",
  "resume",
  "config",
  "reload",
] as const;
type BuiltinSlashCommand = (typeof builtinSlashCommands)[number];

type ParameterizedBuiltinSlashCommand = "resume" | "model";

interface SlashCommandOutcome {
  handled: boolean;
  inputFromCommand: string | null;
}

async function resolveBuiltinSlashCommand(
  command: BuiltinSlashCommand,
): Promise<SlashCommandOutcome> {
  switch (command) {
    case "edit": {
      const content = await spawnAndReadEditorContent();
      if (content !== null) appendToChatHistory(content, "user");
      return { handled: true, inputFromCommand: content };
    }
    case "paste": {
      const content = await spawnAndReadEditorContent({
        includeClipboardSuffix: true,
      });
      if (content !== null) appendToChatHistory(content, "user");
      return { handled: true, inputFromCommand: content };
    }
    case "clear": {
      await clearCommand();
      return { handled: true, inputFromCommand: null };
    }
    case "history": {
      openWithPager({
        initialContentPath: getState().app.chatHistoryPath,
        pagerEnvKey: "AGENT_JS_PAGER_HISTORY",
      });
      return { handled: true, inputFromCommand: null };
    }
    case "model": {
      await getModel();
      return { handled: true, inputFromCommand: null };
    }
    case "skills": {
      await printSkills();
      return { handled: true, inputFromCommand: null };
    }
    case "context": {
      await printContextFiles();
      return { handled: true, inputFromCommand: null };
    }
    case "context-str": {
      await pageContextFiles();
      return { handled: true, inputFromCommand: null };
    }
    case "commands": {
      await printCommands();
      return { handled: true, inputFromCommand: null };
    }
    case "commands-str": {
      pageCommands();
      return { handled: true, inputFromCommand: null };
    }
    case "keymaps": {
      await printKeymaps();
      return { handled: true, inputFromCommand: null };
    }
    case "usage": {
      await printUsage();
      return { handled: true, inputFromCommand: null };
    }
    case "config": {
      openWithPager({
        pagerEnvKey: "AGENT_JS_PAGER_CONFIG",
        initialContentStr: getAllPrettyConfig(),
      });

      return { handled: true, inputFromCommand: null };
    }
    case "resume": {
      await print.error("Usage: /resume [session start date]");
      return { handled: true, inputFromCommand: null };
    }
    case "reload": {
      await reload();
      return { handled: true, inputFromCommand: null };
    }
    default: {
      command satisfies never;
      return { handled: false, inputFromCommand: null };
    }
  }
}

async function resolveParameterizedBuiltinSlashCommand(
  commandWithArgs: string,
): Promise<SlashCommandOutcome> {
  const parts = commandWithArgs.trim().split(/\s+/);
  const command = parts[0] as ParameterizedBuiltinSlashCommand | undefined;
  if (command === undefined) return { handled: false, inputFromCommand: null };

  switch (command) {
    case "model": {
      await setModelCommand(commandWithArgs);
      return { handled: true, inputFromCommand: null };
    }
    case "resume": {
      const content = await resume(commandWithArgs);
      if (content !== null) appendToChatHistory(content, "user");
      return { handled: true, inputFromCommand: content };
    }
    default: {
      command satisfies never;
      return { handled: false, inputFromCommand: null };
    }
  }
}

async function resolveCustomSlashCommand(
  command: string,
): Promise<SlashCommandOutcome> {
  const slashCommands = getState().app.slashCommands;
  const matchedCommand = slashCommands.find((c) => c.name === command);

  if (matchedCommand !== undefined) {
    await print.infoSubtle(`Executing slash command: ${command}`);
    return { handled: true, inputFromCommand: matchedCommand.content };
  }

  return { handled: false, inputFromCommand: null };
}

export async function resolveSlashCommand(rawInput: string) {
  const commandWithoutSlash = rawInput.slice(1);

  const builtinSlashCommandOutcome = await resolveBuiltinSlashCommand(
    commandWithoutSlash as BuiltinSlashCommand,
  );
  if (builtinSlashCommandOutcome.handled) {
    return builtinSlashCommandOutcome.inputFromCommand;
  }

  const parameterizedBuiltinSlashCommandOutcome =
    await resolveParameterizedBuiltinSlashCommand(commandWithoutSlash);
  if (parameterizedBuiltinSlashCommandOutcome.handled) {
    return parameterizedBuiltinSlashCommandOutcome.inputFromCommand;
  }

  const customSlashCommandOutcome =
    await resolveCustomSlashCommand(commandWithoutSlash);
  if (customSlashCommandOutcome.handled) {
    return customSlashCommandOutcome.inputFromCommand;
  }

  await printNewline();
  await print.error(`Invalid command: ${rawInput}, valid commands:`);
  await print(getCommandsStr());
  return null;
}

export async function clearCommand() {
  await print.infoSubtle(`Context cleared (${getPrettyTokenUsage()})`);
  actions.resetMessageParams();
  actions.setModelUsageForSession({});
}

export async function printUsage() {
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
      const editor = processDeps.env.get("EDITOR")!;
      return editor.includes("__FILE__")
        ? editor.replace("__FILE__", tempFile)
        : `${editor} ${tempFile}`;
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

export async function getModel() {
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
  actions.setMessageParamTokensStale(true);
}

export async function pageContextFiles() {
  if (getState().app.contextEntries.length === 0) {
    await printNewline();
    await print.doing("No available context files");
    return;
  }

  openWithPager({
    pagerEnvKey: "AGENT_JS_PAGER_CONTEXT",
    initialContentStr: getState().app.contextStr,
  });
}

export async function printSkills() {
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

export async function printContextFiles() {
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

export async function resume(rawInput: string) {
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

  const chatHistoryFileEntries = listChatHistoryFiles();

  for (const { absolutePath, timestampMs } of chatHistoryFileEntries) {
    if (timestampMs !== Number(sessionStartDate)) continue;

    const readResult = tryCatch(() =>
      fsDeps.readFileSync(absolutePath).toString(),
    );
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

export function pageCommands() {
  const customCommandsStr = getState()
    .app.slashCommands.map((command) => {
      return `${command.filePath}
${"-".repeat(command.filePath.length)}
${command.content}`;
    })
    .join("\n");

  openWithPager({
    pagerEnvKey: "AGENT_JS_PAGER_COMMANDS",
    initialContentStr: customCommandsStr,
  });
}

export async function printCommands() {
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

export async function printKeymaps() {
  await printNewline();
  await print.doing("Keymaps:");
  for (const [command, keymap] of Object.entries(getState().config.keymaps)) {
    await print(`- ${command}: ${JSON.stringify(keymap)}`);
  }
}

function getAllPrettyConfig() {
  const globalConfigTitle = `Global config from path: ${getGlobalConfigPath()}`;
  const localConfigTitle = `Local config from path: ${getLocalConfigPath()}`;

  return `${globalConfigTitle}
${"-".repeat(globalConfigTitle.length)}
${getState().app.globalConfigStr}

${localConfigTitle}
${"-".repeat(localConfigTitle.length)}
${getState().app.localConfigStr}

Applied config:
---------------
${stringify(getState().config)}`;
}

async function reload() {
  const tempFileBefore = getTempFileName({
    initialContentStr: getAllPrettyConfig(),
  });

  await initStateRepeatable();

  const tempFileAfter = getTempFileName({
    initialContentStr: getAllPrettyConfig(),
  });
  const diffResult = await tryCatchAsync(
    execGitDiff({
      tempFileBeforePath: tempFileBefore,
      tempFileAfterPath: tempFileAfter,
    }),
  );
  fsDeps.unlinkSync(tempFileBefore);
  fsDeps.unlinkSync(tempFileAfter);

  if (!diffResult.ok) {
    await print.error(
      `An error occurred when getting the diff: ${getMessageFromError(diffResult.error)}`,
    );
    return;
  }
  if (diffResult.value.stdout.length === 0) {
    await print.info("No diff from reload");
    return;
  }

  openWithPager({
    pagerEnvKey: "AGENT_JS_PAGER_RELOAD",
    initialContentStr: diffResult.value.stdout,
  });
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
    ...getState().config.customSlashCommandDirs,
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
