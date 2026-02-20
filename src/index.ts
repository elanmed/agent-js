import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import { actions, dispatch, selectors } from "./state.ts";
import {
  isAbortError,
  tryCatch,
  colorLog,
  debugLog,
  logNewline,
  calculateSessionCost,
  BASE_SYSTEM_PROMPT,
  getRecursiveAgentsMdFilesStr,
  maybePrintCostMessage,
} from "./utils.ts";
import { BASH_TOOL_SCHEMA, getToolResultBlock } from "./tools.ts";
import { initStateFromConfig } from "./config.ts";

async function main() {
  initStateFromConfig();

  const client = new Anthropic();
  const rl = readline.createInterface({ input, output });

  let currQuestionAbortController: AbortController | null = null;
  let currApiStream: MessageStream | null = null;

  async function callApi(
    messageParam: Anthropic.Messages.MessageParam,
    { prependNewline }: { prependNewline: boolean } = { prependNewline: false },
  ) {
    const messageCount = selectors.getMessageParams().length + 1;
    debugLog(
      `callApi: model=${selectors.getModel()}, messages=${String(messageCount)}`,
    );
    let lastChar: string | undefined = "";
    let isFirstText = true;

    currApiStream = client.messages
      .stream({
        max_tokens: 1024,
        model: selectors.getModel(),
        messages: [...selectors.getMessageParams(), messageParam],
        tools: [BASH_TOOL_SCHEMA],
        system: [BASE_SYSTEM_PROMPT, await getRecursiveAgentsMdFilesStr()].join(
          "\n",
        ),
      })
      .on("text", (text) => {
        if (prependNewline && isFirstText) {
          process.stdout.write("\n");
          isFirstText = false;
        }
        process.stdout.write(text);
        if (text.length > 0) {
          lastChar = text.at(-1);
        }
      });
    const streamResult = await currApiStream.finalMessage();
    currApiStream = null;
    debugLog(
      `callApi: stop_reason=${String(streamResult.stop_reason)}, input_tokens=${String(streamResult.usage.input_tokens)}, output_tokens=${String(streamResult.usage.output_tokens)}`,
    );

    if (lastChar && lastChar !== "\n") {
      process.stdout.write("\n");
    }

    dispatch(actions.appendToMessageParams(messageParam));
    dispatch(actions.appendToMessageUsages(streamResult.usage));
    dispatch(
      actions.appendToMessageParams({
        content: streamResult.content,
        role: streamResult.role,
      }),
    );

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
    const inputResult = await tryCatch(
      rl.question("> ", { signal: currQuestionAbortController.signal }),
    );
    currQuestionAbortController = null;

    if (!inputResult.ok) {
      if (!isAbortError(inputResult.error)) throw inputResult.error;

      dispatch(actions.setInterrupted(true));
      currQuestionAbortController = new AbortController();
      const exitResult = await tryCatch(
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

    if (inputResult.value === "") {
      colorLog("Empty input, aborting", "red");
      continue;
    }

    const inputMessageParam: Anthropic.Messages.MessageParam = {
      content: [
        {
          text: inputResult.value,
          type: "text",
          cache_control: { type: "ephemeral" },
        },
      ],
      role: "user",
    };
    const messageCountBeforeTurn = selectors.getMessageParams().length;
    const streamResult = await tryCatch(callApi(inputMessageParam));

    if (!streamResult.ok) {
      if (streamResult.error instanceof Anthropic.APIUserAbortError) {
        colorLog("\nAborted", "red");
        maybePrintCostMessage();
        continue;
      } else {
        throw streamResult.error;
      }
    }

    let currentMessage = streamResult.value;
    while (currentMessage.stop_reason === "tool_use") {
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const contentBlock of currentMessage.content) {
        if (contentBlock.type === "tool_use") {
          const toolResultBlock = await getToolResultBlock(contentBlock);
          toolResults.push(toolResultBlock);
        }
      }

      const toolResultsMessage: Anthropic.Messages.MessageParam = {
        content: toolResults.map((toolResult) => ({
          ...toolResult,
          cache_control: { type: "ephemeral" },
        })),
        role: "user",
      };

      const toolStreamResult = await tryCatch(
        callApi(toolResultsMessage, { prependNewline: true }),
      );

      if (toolStreamResult.ok) {
        currentMessage = toolStreamResult.value;
      } else {
        if (toolStreamResult.error instanceof Anthropic.APIUserAbortError) {
          colorLog("\nAborted", "red");
          dispatch(actions.truncateMessageParams(messageCountBeforeTurn));
          break;
        } else {
          throw toolStreamResult.error;
        }
      }
    }

    maybePrintCostMessage();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
