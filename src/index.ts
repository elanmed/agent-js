import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
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
} from "./utils.ts";
import {
  BASH_TOOL_SCHEMA,
  CREATE_FILE_TOOL_SCHEMA,
  VIEW_FILE_TOOL_SCHEMA,
  STR_REPLACE_TOOL_SCHEMA,
  INSERT_LINES_TOOL_SCHEMA,
  getToolResultBlock,
  type ToolCall,
} from "./tools.ts";
import { initStateFromConfig } from "./config.ts";
import { join } from "node:path";
// TODO: better type?
import type { ChatCompletionStream } from "openai/lib/ChatCompletionStream.mjs";

async function main() {
  initStateFromConfig();
  const availableSlashCommands = getAvailableSlashCommands();

  const client = new OpenAI({
    baseURL: selectors.getBaseURL() ?? undefined,
  });
  const rl = readline.createInterface({ input, output });

  let currQuestionAbortController: AbortController | null = null;
  let currApiStream: ChatCompletionStream | null = null;

  async function callApi(
    newMessages: OpenAI.Chat.ChatCompletionMessageParam[],
    { prependNewline }: { prependNewline: boolean } = { prependNewline: false },
  ) {
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

    currApiStream = client.chat.completions.stream({
      model: selectors.getModel(),
      messages: [
        { role: "system", content: systemContent },
        ...selectors.getMessageParams(),
        ...newMessages,
      ],
      tools: [
        BASH_TOOL_SCHEMA,
        CREATE_FILE_TOOL_SCHEMA,
        VIEW_FILE_TOOL_SCHEMA,
        STR_REPLACE_TOOL_SCHEMA,
        INSERT_LINES_TOOL_SCHEMA,
      ],
      max_completion_tokens: 8192,
      stream_options: { include_usage: true },
    });

    let streamResult: OpenAI.Chat.ChatCompletion;
    try {
      streamResult = await currApiStream.finalChatCompletion();
    } finally {
      clearSpinner();
      currApiStream = null;
    }

    const choice = streamResult.choices[0];
    if (!choice) throw new Error("No choices in completion response");

    debugLog(
      `callApi: finish_reason=${choice.finish_reason}, prompt_tokens=${String(streamResult.usage?.prompt_tokens)}, completion_tokens=${String(streamResult.usage?.completion_tokens)}`,
    );

    const fullText = choice.message.content ?? "";
    if (fullText) {
      if (prependNewline) process.stdout.write("\n");
      await executeBat(fullText);
    }

    for (const message of newMessages) {
      dispatch(actions.appendToMessageParams(message));
    }
    if (streamResult.usage) {
      dispatch(actions.appendToMessageUsages(streamResult.usage));
    }
    dispatch(actions.appendToMessageParams(choice.message));

    return streamResult;
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
      if (!isAbortError(inputResult.error)) throw inputResult.error;

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

    const inputMessageParam: OpenAI.Chat.ChatCompletionUserMessageParam = {
      role: "user",
      content: inputResultValue,
    };
    const messageCountBeforeTurn = selectors.getMessageParams().length;
    const streamResult = await tryCatchAsync(callApi([inputMessageParam]));

    if (!streamResult.ok) {
      if (streamResult.error instanceof OpenAI.APIUserAbortError) {
        colorLog("Aborted", "red");
        maybePrintUsageMessage();
        continue;
      } else {
        throw streamResult.error;
      }
    }

    // TODO: handle multiple choices?
    let currentChoice = streamResult.value.choices[0];
    while (currentChoice?.finish_reason === "tool_calls") {
      const toolCalls = currentChoice.message.tool_calls ?? [];
      const toolMessages: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];

      for (const toolCall of toolCalls) {
        if (toolCall.type !== "function") continue;
        const localToolCall: ToolCall = {
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments) as unknown,
        };
        const toolResult = await getToolResultBlock(localToolCall);
        toolMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult.content,
        });
      }

      const toolStreamResult = await tryCatchAsync(
        callApi(toolMessages, { prependNewline: true }),
      );

      if (toolStreamResult.ok) {
        currentChoice = toolStreamResult.value.choices[0];
      } else {
        if (toolStreamResult.error instanceof OpenAI.APIUserAbortError) {
          colorLog("Aborted", "red");
          dispatch(actions.truncateMessageParams(messageCountBeforeTurn));
          break;
        } else {
          throw toolStreamResult.error;
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
