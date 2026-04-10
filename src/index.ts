/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import type { ModelMessage } from "ai";
import { actions, dispatch, selectors } from "./state.ts";
import {
  isAbortError,
  colorLog,
  debugLog,
  logNewline,
  maybePrintUsageMessage,
  tryCatchAsync,
  getAvailableSlashCommands,
  readFromEditor,
  getMessageFromError,
} from "./utils.ts";
import { getToolResultBlock, type ToolCall } from "./tools.ts";
import { initStateFromConfig } from "./config.ts";
import { callApi } from "./api.ts";
import { join } from "node:path";

interface ToolMessage {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output:
    | { type: "text"; value: string }
    | { type: "error-text"; value: string };
}

async function main() {
  initStateFromConfig();
  const availableSlashCommands = getAvailableSlashCommands();

  const rl = readline.createInterface({ input, output });

  rl.on("SIGINT", () => {
    const apiStream = selectors.getApiStreamAbortController();
    if (apiStream) {
      apiStream.abort();
    }

    const questionAbortController = selectors.getQuestionAbortController();
    if (questionAbortController) {
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
    const questionController = selectors.getQuestionAbortController();
    const inputResult = await tryCatchAsync(
      rl.question("> ", { signal: questionController!.signal }),
    );
    dispatch(actions.setQuestionAbortController(null));

    if (!inputResult.ok) {
      if (!isAbortError(inputResult.error)) {
        console.error(getMessageFromError(inputResult.error));
        continue;
      }

      dispatch(actions.setInterrupted(true));
      dispatch(actions.setQuestionAbortController(new AbortController()));
      const exitQuestionController = selectors.getQuestionAbortController();
      const exitResult = await tryCatchAsync(
        rl.question("y(es) or <C-c> to exit: ", {
          signal: exitQuestionController!.signal,
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
    logNewline();

    let inputResultValue = inputResult.value;
    if (inputResult.value.at(0) === "/") {
      const commandWithoutSlash = inputResult.value.slice(1);
      if (commandWithoutSlash === "e") {
        inputResultValue = readFromEditor();
      } else if (commandWithoutSlash === "clear") {
        dispatch(actions.resetMessageUsages());
        dispatch(actions.resetMessageParams());
        debugLog("Reset message usages and message params");
        colorLog("Context cleared", "grey");
        continue;
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
    dispatch(actions.setApiStreamAbortController(new AbortController()));
    const apiStreamController = selectors.getApiStreamAbortController();
    const streamResult = await tryCatchAsync(
      callApi(
        [inputMessageParam],
        { prependNewline: false },
        apiStreamController!.signal,
      ),
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
        callApi(
          [toolMessage],
          { prependNewline: true },
          toolApiStreamController!.signal,
        ),
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

    logNewline();
    maybePrintUsageMessage();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    colorLog(getMessageFromError(error), "red");
    process.exit(1);
  });
}
