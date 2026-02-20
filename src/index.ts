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
import { BASH_TOOL_SCHEMA, getBashToolMessageParam } from "./tools.ts";

// TODO: support config file
const MODEL: Anthropic.Messages.Model = "claude-haiku-4-5";

async function main() {
  const client = new Anthropic();
  const rl = readline.createInterface({ input, output });

  let currQuestionAbortController: AbortController | null = null;
  let currApiStream: MessageStream | null = null;

  async function callApi(messageParam: Anthropic.Messages.MessageParam) {
    dispatch(actions.appendToMessageParams(messageParam));

    currApiStream = client.messages
      .stream({
        max_tokens: 1024,
        model: MODEL,
        messages: selectors.getMessageParams(),
        tools: [BASH_TOOL_SCHEMA],
        system:
          "You are an AI agent being called from a minimal terminal cli. All your responses will be output directly to the terminal without any alteration. Keep your responses brief as to not pollute the terminal.",
      })
      .on("text", (text) => {
        process.stdout.write(text);
      });
    const streamResult = await currApiStream.finalMessage();
    currApiStream = null;

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
        dispatch(actions.popLastMessageParam());
        logNewline();
        colorLog("Aborted", "red");
        logNewline();
        continue;
      }
      throw streamResult.error;
    }

    let stopReason = streamResult.value.stop_reason;
    while (stopReason === "tool_use") {
      const toolUseBlock = streamResult.value.content.find(
        (contentBlock) => contentBlock.type === "tool_use",
      );
      if (!toolUseBlock) {
        throw new Error(
          "`stop_reason` was `tool_use` but could not find a content block with a type of `tool_use`",
        );
      }

      let messageParam: Anthropic.Messages.MessageParam | null = null;

      switch (toolUseBlock.name) {
        case "bash": {
          messageParam = await getBashToolMessageParam(toolUseBlock);
          break;
        }
      }

      if (!messageParam) {
        throw new Error(
          "Failed to create a `messageParam` when processing the tool call",
        );
      }

      const toolStreamResult = await tryCatch(callApi(messageParam));

      if (!toolStreamResult.ok) {
        if (toolStreamResult.error instanceof Anthropic.APIUserAbortError) {
          dispatch(actions.popLastMessageParam());
          logNewline();
          colorLog("Aborted", "red");
          logNewline();
          break;
        }
        throw toolStreamResult.error;
      }

      stopReason = toolStreamResult.value.stop_reason;
    }

    logNewline();
    colorLog(
      calculateSessionCost(MODEL, selectors.getMessageUsages()),
      "green",
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(0);
  });
}
