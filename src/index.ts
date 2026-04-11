/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as readline from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import type { ModelMessage, ToolSet } from "ai";
import { actions, dispatch, selectors } from "./state.ts";
import {
  isAbortError,
  colorLog,
  debugLog,
  maybePrintUsageMessage,
  tryCatchAsync,
  getAvailableSlashCommands,
  readFromEditor,
  getMessageFromError,
  executeBat,
  BASE_SYSTEM_PROMPT,
  getRecursiveAgentsMdFilesStr,
} from "./utils.ts";
import { getToolResultBlock, type ToolCall } from "./tools.ts";
import { initStateFromConfig } from "./config.ts";
import { join } from "node:path";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { TOOLS } from "./tools.ts";

interface ToolMessage {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output:
    | { type: "text"; value: string }
    | { type: "error-text"; value: string };
}

function getLanguageModel() {
  const provider = selectors.getProvider();
  const modelName = selectors.getModel();
  const apiKey = process.env["AGENT_JS_API_KEY"];

  if (provider === "anthropic") {
    return createAnthropic({ ...(apiKey && { apiKey }) })(modelName);
  }

  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: selectors.getBaseURL(),
    ...(apiKey && { apiKey }),
  })(modelName);
}

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface CallApiResult {
  finishReason: string;
  toolCalls: ToolCallInfo[];
}

export async function callApi(
  newMessages: ModelMessage[],
  abortSignal?: AbortSignal,
): Promise<CallApiResult> {
  const messageCount = selectors.getMessageParams().length + newMessages.length;
  debugLog(
    `callApi: model=${selectors.getModel()}, messages=${String(messageCount)}`,
  );

  const spinnerFrames = ["|", "/", "-", "\\"];
  let spinnerIdx = 0;
  const spinnerInterval = setInterval(() => {
    process.stdout.write(
      `\r${String(spinnerFrames[spinnerIdx++ % spinnerFrames.length])}`,
    );
  }, 80);
  let spinnerCleared = false;
  const clearSpinner = () => {
    if (spinnerCleared) return;
    clearInterval(spinnerInterval);
    process.stdout.write("\r \r");
    spinnerCleared = true;
  };

  const systemContent = [
    BASE_SYSTEM_PROMPT,
    await getRecursiveAgentsMdFilesStr(),
  ].join("\n");

  try {
    const { text, finishReason, toolCalls, usage, response } =
      await generateText({
        model: getLanguageModel(),
        system: systemContent,
        messages: [...selectors.getMessageParams(), ...newMessages],
        tools: TOOLS as unknown as ToolSet,
        maxOutputTokens: 8192,
        ...(abortSignal && { abortSignal }),
      });

    debugLog(
      `callApi: finish_reason=${finishReason}, prompt_tokens=${String(usage.inputTokens)}, completion_tokens=${String(usage.outputTokens)}`,
    );

    clearSpinner();

    if (text) {
      await executeBat(text);
    }

    for (const message of newMessages) {
      dispatch(actions.appendToMessageParams(message));
    }
    dispatch(
      actions.appendToMessageUsages({
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
      }),
    );
    for (const msg of response.messages) {
      dispatch(actions.appendToMessageParams(msg));
    }

    return {
      finishReason,
      toolCalls: toolCalls.map((toolCall) => ({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
      })),
    };
  } finally {
    clearSpinner();
  }
}

async function main() {
  initStateFromConfig();
  const availableSlashCommands = getAvailableSlashCommands();

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

  while (selectors.getRunning()) {
    dispatch(actions.setQuestionAbortController(new AbortController()));
    const questionAbortController = selectors.getQuestionAbortController();
    const inputResult = await tryCatchAsync(
      rl.question("> ", { signal: questionAbortController!.signal }),
    );
    dispatch(actions.setQuestionAbortController(null));

    const editorInputValue = selectors.getEditorInputValue();
    let inputResultValue: string;
    if (!inputResult.ok) {
      if (!isAbortError(inputResult.error)) {
        console.error(getMessageFromError(inputResult.error));
        continue;
      }

      if (editorInputValue !== null) {
        inputResultValue = editorInputValue;
      } else {
        dispatch(actions.setInterrupted(true));
        dispatch(actions.setQuestionAbortController(new AbortController()));
        const exitQuestionAbortController =
          selectors.getQuestionAbortController();
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
            rl.close();
          }
        } else {
          // second <C-c> during confirmation is already handled by SIGINT
        }

        dispatch(actions.setInterrupted(false));
        continue;
      }
    } else {
      inputResultValue = inputResult.value;
    }

    if (editorInputValue === null && inputResultValue.at(0) === "/") {
      const commandWithoutSlash = inputResultValue.slice(1);
      if (commandWithoutSlash === "edit") {
        inputResultValue = readFromEditor("");
      } else if (commandWithoutSlash === "clear") {
        dispatch(actions.resetMessageUsages());
        dispatch(actions.resetMessageParams());
        debugLog("Reset message usages and message params");
        colorLog("Context cleared", "grey");
        continue;
      } else if (availableSlashCommands.includes(commandWithoutSlash)) {
        colorLog(`Executing slash command: ${inputResultValue}`, "grey");
        const path = join(
          process.cwd(),
          ".agent-js",
          "commands",
          inputResultValue.slice(1).concat(".md"),
        );
        debugLog(`Performing the slash command at ${path}`);
        inputResultValue = `Perform the instructions located at ${path}`;
      } else {
        colorLog(
          `Invalid / command detected, valid commands: ${availableSlashCommands.join(",")}`,
          "red",
        );
        maybePrintUsageMessage();
        continue;
      }
    }
    dispatch(actions.setEditorInputValue(null));

    if (inputResultValue === "") {
      colorLog("Empty input, aborting", "red");
      continue;
    }

    const inputMessageParam: ModelMessage = {
      role: "user",
      content: inputResultValue,
    };
    const messageCountBeforeTurn = selectors.getMessageParams().length;
    dispatch(actions.setApiStreamAbortController(new AbortController()));
    const apiStreamController = selectors.getApiStreamAbortController();
    const streamResult = await tryCatchAsync(
      callApi([inputMessageParam], apiStreamController!.signal),
    );
    dispatch(actions.setApiStreamAbortController(null));

    if (!streamResult.ok) {
      if (isAbortError(streamResult.error)) {
        colorLog("Aborted", "red");
        maybePrintUsageMessage();
        continue;
      } else {
        colorLog(getMessageFromError(streamResult.error), "red");
        continue;
      }
    }

    let currentResult = streamResult.value;
    while (currentResult.finishReason === "tool-calls") {
      const toolMessages: ToolMessage[] = [];

      for (const toolCall of currentResult.toolCalls) {
        const localToolCall: ToolCall = {
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          input: toolCall.input,
        };
        const toolResult = await getToolResultBlock(localToolCall);
        toolMessages.push({
          type: "tool-result",
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          output: toolResult.is_error
            ? { type: "error-text", value: toolResult.content }
            : { type: "text", value: toolResult.content },
        });
      }

      const toolMessage: ModelMessage = {
        role: "tool",
        content: toolMessages,
      };

      dispatch(actions.setApiStreamAbortController(new AbortController()));
      const toolApiStreamController = selectors.getApiStreamAbortController();
      const toolStreamResult = await tryCatchAsync(
        callApi([toolMessage], toolApiStreamController!.signal),
      );
      dispatch(actions.setApiStreamAbortController(null));

      if (toolStreamResult.ok) {
        currentResult = toolStreamResult.value;
      } else {
        if (isAbortError(toolStreamResult.error)) {
          colorLog("Aborted", "red");
          dispatch(actions.truncateMessageParams(messageCountBeforeTurn));
          break;
        } else {
          colorLog(getMessageFromError(toolStreamResult.error), "red");
          continue;
        }
      }
    }

    maybePrintUsageMessage();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    colorLog(getMessageFromError(error), "red");
    process.exit(1);
  });
}
