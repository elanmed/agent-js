import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { actions, dispatch, selectors } from "./state.ts";
import {
  isAbortError,
  colorLog,
  debugLog,
  logNewline,
  BASE_SYSTEM_PROMPT,
  getRecursiveAgentsMdFilesStr,
  maybePrintUsageMessage,
  tryCatchAsync,
  getAvailableSlashCommands,
  readFromEditor,
  executeBat,
  getMessageFromError,
} from "./utils.ts";
import { TOOLS, getToolResultBlock, type ToolCall } from "./tools.ts";
import { initStateFromConfig } from "./config.ts";
import { join } from "node:path";

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

interface ToolMessage {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output:
    | { type: "text"; value: string }
    | { type: "error-text"; value: string };
}

interface CallApiResult {
  finishReason: string;
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
}

async function main() {
  initStateFromConfig();
  const availableSlashCommands = getAvailableSlashCommands();

  const rl = readline.createInterface({ input, output });

  let currQuestionAbortController: AbortController | null = null;
  let currApiStream: AbortController | null = null;

  async function callApi(
    newMessages: ModelMessage[],
    { prependNewline }: { prependNewline: boolean } = { prependNewline: false },
  ): Promise<CallApiResult> {
    const messageCount =
      selectors.getMessageParams().length + newMessages.length;
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

    const abortController = new AbortController();
    currApiStream = abortController;

    try {
      const { text, finishReason, toolCalls, usage, response } =
        await generateText({
          model: getLanguageModel(),
          system: systemContent,
          messages: [...selectors.getMessageParams(), ...newMessages],
          tools: TOOLS as unknown as ToolSet,
          maxOutputTokens: 8192,
          abortSignal: abortController.signal,
        });

      debugLog(
        `callApi: finish_reason=${finishReason}, prompt_tokens=${String(usage.inputTokens)}, completion_tokens=${String(usage.outputTokens)}`,
      );

      clearSpinner();

      if (text) {
        if (prependNewline) process.stdout.write("\n");
        await executeBat(text);
      }

      for (const message of newMessages) {
        dispatch(actions.appendToMessageParams(message));
      }
      dispatch(
        actions.appendToMessageUsages({
          prompt_tokens: usage.inputTokens ?? 0,
          completion_tokens: usage.outputTokens ?? 0,
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
      currApiStream = null;
    }
  }

  rl.on("SIGINT", () => {
    if (currApiStream) {
      currApiStream.abort();
    }

    if (currQuestionAbortController) {
      currQuestionAbortController.abort();
    }

    // second <C-c> during exit confirmation
    if (selectors.getInterrupted()) {
      rl.close();
      process.exit(0);
    }
  });

  while (selectors.getRunning()) {
    currQuestionAbortController = new AbortController();
    const inputResult = await tryCatchAsync(
      rl.question("> ", { signal: currQuestionAbortController.signal }),
    );
    currQuestionAbortController = null;

    if (!inputResult.ok) {
      if (!isAbortError(inputResult.error)) {
        console.error(getMessageFromError(inputResult.error));
        continue;
      }

      dispatch(actions.setInterrupted(true));
      currQuestionAbortController = new AbortController();
      const exitResult = await tryCatchAsync(
        rl.question("y(es) or <C-c> to exit: ", {
          signal: currQuestionAbortController.signal,
        }),
      );
      currQuestionAbortController = null;

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
    logNewline();

    let inputResultValue = inputResult.value;
    if (inputResult.value.at(0) === "/") {
      const commandWithoutSlash = inputResult.value.slice(1);
      if (commandWithoutSlash === "e") {
        inputResultValue = readFromEditor();
      } else if (availableSlashCommands.includes(commandWithoutSlash)) {
        colorLog(`Executing slash command: ${inputResult.value}`, "grey");
        const path = join(
          process.cwd(),
          ".agent-js",
          "commands",
          inputResult.value.slice(1).concat(".md"),
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

    if (inputResultValue === "") {
      colorLog("Empty input, aborting", "red");
      continue;
    }

    const inputMessageParam: ModelMessage = {
      role: "user",
      content: inputResultValue,
    };
    const messageCountBeforeTurn = selectors.getMessageParams().length;
    const streamResult = await tryCatchAsync(callApi([inputMessageParam]));

    if (!streamResult.ok) {
      if (isAbortError(streamResult.error)) {
        colorLog("Aborted", "red");
        maybePrintUsageMessage();
        continue;
      } else {
        console.error(getMessageFromError(streamResult.error));
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

      const toolStreamResult = await tryCatchAsync(
        callApi([toolMessage], { prependNewline: true }),
      );

      if (toolStreamResult.ok) {
        currentResult = toolStreamResult.value;
      } else {
        if (isAbortError(toolStreamResult.error)) {
          colorLog("Aborted", "red");
          dispatch(actions.truncateMessageParams(messageCountBeforeTurn));
          break;
        } else {
          console.error(getMessageFromError(toolStreamResult.error));
          continue;
        }
      }
    }

    logNewline();
    maybePrintUsageMessage();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
