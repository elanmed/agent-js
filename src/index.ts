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
  logNewline,
  calculateSessionCost,
} from "./utils.ts";
import { BASH_TOOL_SCHEMA, getToolResultBlock } from "./tools.ts";

async function main() {
  const client = new Anthropic();
  const rl = readline.createInterface({ input, output });

  let currQuestionAbortController: AbortController | null = null;
  let currApiStream: MessageStream | null = null;

  async function callApi(messageParam: Anthropic.Messages.MessageParam) {
    let lastChar: string | undefined = "";

    currApiStream = client.messages
      .stream({
        max_tokens: 1024,
        model: selectors.getModel(),
        messages: [...selectors.getMessageParams(), messageParam],
        tools: [BASH_TOOL_SCHEMA],
        system:
          "You are an AI agent being called from a minimal terminal cli. All your responses will be output directly to the terminal without any alteration. Keep your responses brief as to not pollute the terminal. Avoid markdown syntax since it will not be parsed by the terminal, and unparsed markdown is difficult to read.",
      })
      .on("text", (text) => {
        process.stdout.write(text);
        if (text.length > 0) {
          lastChar = text.at(-1);
        }
      });
    const streamResult = await currApiStream.finalMessage();
    currApiStream = null;

    if (lastChar !== "\n") {
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

    const streamResult = await tryCatch(
      callApi({
        content: [
          {
            text: inputResult.value,
            type: "text",
            cache_control: { type: "ephemeral" },
          },
        ],
        role: "user",
      }),
    );

    if (!streamResult.ok) {
      if (streamResult.error instanceof Anthropic.APIUserAbortError) {
        colorLog("\nAborted\n", "red");
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

      const toolStreamResult = await tryCatch(callApi(toolResultsMessage));

      if (toolStreamResult.ok) {
        currentMessage = toolStreamResult.value;
      } else {
        if (toolStreamResult.error instanceof Anthropic.APIUserAbortError) {
          colorLog("\nAborted\n", "red");
          break;
        } else {
          throw toolStreamResult.error;
        }
      }
    }

    if (!selectors.getDisableCostMessage()) {
      logNewline();
      colorLog(
        calculateSessionCost(
          selectors.getModel(),
          selectors.getMessageUsages(),
        ),
        "green",
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
